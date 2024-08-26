/*
TODO:
 - load RVC models list from extras
 - Settings per characters
*/

import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { getContext, getApiUrl, extension_settings, doExtrasFetch, modules, renderExtensionTemplateAsync } from '../../../extensions.js';
import { isValidUrl } from '../../../utils.js';
export { MODULE_NAME, rvcVoiceConversion };

const MODULE_NAME = 'third-party/Extension-RVC';
const DEBUG_PREFIX = '<RVC module> ';

const sources = {
    extras: 'extras',
    rvcPython: 'rvc-python',
};

const toastOptions = { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true };

/**
 * @typedef {Object} RvcModelsList
 * @property {string[]} models_list - List of available models
 */

/**
 * RVC Provider interface
 * @interface
 */
class RvcProvider {
    constructor() {
    }
    /**
     * Upload models to the provider
     * @function
     * @name RvcProvider#uploadModels
     * @param {File[]} inputFiles - The files to upload
     * @returns {Promise<void>}
     */
    uploadModels(inputFiles) { }

    /**
     * Get the list of models available
     * @function
     * @name RvcProvider#getModelsList
     * @returns {Promise<RvcModelsList>}
     */
    getModelsList() { }

    /**
     * Verify if the provider is available
     * @function
     * @name RvcProvider#verifySource
     * @param {boolean} throwOnFail - Throw an error if the provider is not available
     * @returns {boolean}
     */
    verifySource(throwOnFail) { }

    /**
     * Convert voice using the provider
     * @function
     * @name RvcProvider#convertVoice
     * @param {Blob} audioData Audio data to convert
     * @param {object} voiceSettings RVC voice settings
     * @param {string} text Text to convert
     * @returns {Promise<Response>} Fetch response
     */
    convertVoice(audioData, voiceSettings, text) { }
}

/**
 * @implements {RvcProvider}
 */
class ExtrasProvider {
    verifySource(throwOnFail = true) {
        if (!modules.includes('rvc')) {
            if (throwOnFail) {
                throw new Error('RVC module is not available');
            }

            return false;
        }

        return true;
    }

    async uploadModels(inputFiles) {
        this.verifySource();
        let formData = new FormData();

        for (const file of inputFiles) {
            formData.append(file.name, file);
        }

        console.debug(DEBUG_PREFIX, 'Sending files:', formData);
        const url = new URL(getApiUrl());
        url.pathname = '/api/voice-conversion/rvc/upload-models';

        const apiResult = await doExtrasFetch(url, {
            method: 'POST',
            body: formData,
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, DEBUG_PREFIX + ' Check extras console for errors log');
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        toastr.info('The files have been uploaded successfully.');
    }

    async getModelsList() {
        this.verifySource();
        const url = new URL(getApiUrl());
        url.pathname = '/api/voice-conversion/rvc/get-models-list';

        const apiResult = await doExtrasFetch(url, {
            method: 'POST',
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, DEBUG_PREFIX + ' Check model state request failed');
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        const jsonResult = await apiResult.json();
        return jsonResult;
    }

    async convertVoice(audioData, voiceSettings, text) {
        this.verifySource();
        const requestData = new FormData();
        requestData.append('AudioFile', audioData, 'record');
        requestData.append('json', JSON.stringify({
            'modelName': voiceSettings['modelName'],
            'pitchExtraction': voiceSettings['pitchExtraction'],
            'pitchOffset': voiceSettings['pitchOffset'],
            'indexRate': voiceSettings['indexRate'],
            'filterRadius': voiceSettings['filterRadius'],
            'rmsMixRate': voiceSettings['rmsMixRate'],
            'protect': voiceSettings['protect'],
            'text': text,
        }));

        console.log('Sending tts audio data to RVC on extras server', requestData);

        const url = new URL(getApiUrl());
        url.pathname = '/api/voice-conversion/rvc/process-audio';

        const apiResult = await doExtrasFetch(url, {
            method: 'POST',
            body: requestData,
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, DEBUG_PREFIX + ' RVC Voice Conversion Failed', toastOptions);
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        return apiResult;
    }
}

/**
 * @implements {RvcProvider}
 */
class RvcPythonProvider {
    verifySource(throwOnFail = true) {
        if (!extension_settings.rvc.rvcPythonApiUrl || !isValidUrl(extension_settings.rvc.rvcPythonApiUrl)) {
            if (throwOnFail) {
                throw new Error('rvc-python API URL is not set');
            }

            return false;
        }

        return true;
    }

    async uploadModels(inputFiles) {
        this.verifySource();

        const url = new URL(extension_settings.rvc.rvcPythonApiUrl);
        url.pathname = '/upload_model';

        for (const file of inputFiles) {
            const formData = new FormData();
            formData.append('file', file);
            console.debug(DEBUG_PREFIX, 'Sending file:', formData);

            const apiResult = await fetch(url, {
                method: 'POST',
                body: formData,
            });

            if (!apiResult.ok) {
                toastr.error(apiResult.statusText, DEBUG_PREFIX + ' Check rvc-python console for errors log');
                throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
            }
        }

        toastr.info('The files have been uploaded successfully.');
    }

    async getModelsList() {
        this.verifySource();
        const url = new URL(extension_settings.rvc.rvcPythonApiUrl);
        url.pathname = '/models';

        const apiResult = await fetch(url, {});

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, DEBUG_PREFIX + ' Check model state request failed');
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        const jsonResult = await apiResult.json();
        return { models_list: jsonResult.models };
    }

    /**
     * Gets supported conversion method name.
     * @param {string} method Original method name
     * @returns {string} Converted method name
     */
    #getMethod(method) {
        switch (method) {
            case 'torchcrepe':
                return 'crepe';
            case 'harvest':
                return 'harvest';
            case 'pm':
                return 'pm';
            case 'rmvpe':
                return 'rmvpe';
            case 'dio':
            default:
                return 'harvest';
        }
    }

    async convertVoice(audioData, voiceSettings, _text) {
        this.verifySource();

        const setDeviceUrl = new URL(extension_settings.rvc.rvcPythonApiUrl);
        setDeviceUrl.pathname = '/set_device';
        const setDeviceResponse = await fetch(setDeviceUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                device: extension_settings.rvc.rvcPythonCuda ? 'cuda' : 'cpu',
            }),
        });

        if (!setDeviceResponse.ok) {
            toastr.error('Could not set device', DEBUG_PREFIX + ' RVC Voice Conversion Failed', toastOptions);
            throw new Error(`HTTP ${setDeviceResponse.status}: ${await setDeviceResponse.text()}`);
        }

        const setModelUrl = new URL(extension_settings.rvc.rvcPythonApiUrl);
        setModelUrl.pathname = `/models/${encodeURIComponent(voiceSettings['modelName'])}`;
        const setModelResponse = await fetch(setModelUrl, { method: 'POST' });

        if (!setModelResponse.ok) {
            toastr.error('Could not load model', DEBUG_PREFIX + ' RVC Voice Conversion Failed', toastOptions);
            throw new Error(`HTTP ${setModelResponse.status}: ${await setModelResponse.text()}`);
        }

        const setParamsUrl = new URL(extension_settings.rvc.rvcPythonApiUrl);
        setParamsUrl.pathname = '/params';

        const setParamsResponse = await fetch(setParamsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                params: {
                    f0method: this.#getMethod(voiceSettings['pitchExtraction']),
                    f0up_key: parseInt(voiceSettings['pitchOffset']),
                    index_rate: parseFloat(voiceSettings['indexRate']),
                    filter_radius: parseInt(voiceSettings['filterRadius']),
                    rms_mix_rate: parseFloat(voiceSettings['rmsMixRate']),
                    protect: parseFloat(voiceSettings['protect']),
                }
            }),
        });

        if (!setParamsResponse.ok) {
            toastr.error('Could not set parameters', DEBUG_PREFIX + ' RVC Voice Conversion Failed', toastOptions);
            throw new Error(`HTTP ${setParamsResponse.status}: ${await setParamsResponse.text()}`);
        }

        // Convert blob to base64
        const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(audioData);
        });

        const convertUrl = new URL(extension_settings.rvc.rvcPythonApiUrl);
        convertUrl.pathname = '/convert';

        const apiResult = await fetch(convertUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                audio_data: base64Data,
            }),
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, DEBUG_PREFIX + ' RVC Voice Conversion Failed', toastOptions);
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        return apiResult;
    }
}

/**
 * @type {Object.<string, RvcProvider>}
 */
const providers = {
    [sources.extras]: new ExtrasProvider(),
    [sources.rvcPython]: new RvcPythonProvider(),
}

let charactersList = []; // Updated with module worker
let rvcModelsList = []; // Initialized only once
let rvcModelsReceived = false;

function updateVoiceMapText() {
    let voiceMapText = '';
    for (let i in extension_settings.rvc.voiceMap) {
        const voice_settings = extension_settings.rvc.voiceMap[i];
        voiceMapText += i + ':'
            + voice_settings['modelName'] + '('
            + voice_settings['pitchExtraction'] + ','
            + voice_settings['pitchOffset'] + ','
            + voice_settings['indexRate'] + ','
            + voice_settings['filterRadius'] + ','
            + voice_settings['rmsMixRate'] + ','
            + voice_settings['protect']
            + '),\n';
    }

    extension_settings.rvc.voiceMapText = voiceMapText;
    $('#rvc_voice_map').val(voiceMapText);

    console.debug(DEBUG_PREFIX, 'Updated voice map debug text to\n', voiceMapText);
}

//#############################//
//  Extension UI and Settings  //
//#############################//

const defaultSettings = {
    source: sources.extras,
    rvcPythonApiUrl: 'http://localhost:5050',
    rvcPythonCuda: false,
    enabled: false,
    model: '',
    pitchOffset: 0,
    pitchExtraction: 'harvest',
    indexRate: 0.88,
    filterRadius: 3,
    rmsMixRate: 1,
    protect: 0.33,
    voicMapText: '',
    voiceMap: {},
};

function loadSettings() {
    if (extension_settings.rvc === undefined)
        extension_settings.rvc = {};

    if (Object.keys(extension_settings.rvc).length === 0) {
        Object.assign(extension_settings.rvc, defaultSettings);
    }

    for (const key in defaultSettings) {
        if (extension_settings.rvc[key] === undefined) {
            extension_settings.rvc[key] = defaultSettings[key];
        }
    }

    $('#rvc_enabled').prop('checked', extension_settings.rvc.enabled);
    $('#rvc_model').val(extension_settings.rvc.model);

    $('#rvc_pitch_extraction').val(extension_settings.rvc.pitchExtraction);
    $('#rvc_pitch_extractiont_value').text(extension_settings.rvc.pitchExtraction);

    $('#rvc_index_rate').val(extension_settings.rvc.indexRate);
    $('#rvc_index_rate_value').text(extension_settings.rvc.indexRate);

    $('#rvc_filter_radius').val(extension_settings.rvc.filterRadius);
    $('#rvc_filter_radius_value').text(extension_settings.rvc.filterRadius);

    $('#rvc_pitch_offset').val(extension_settings.rvc.pitchOffset);
    $('#rvc_pitch_offset_value').text(extension_settings.rvc.pitchOffset);

    $('#rvc_rms_mix_rate').val(extension_settings.rvc.rmsMixRate);
    $('#rvc_rms_mix_rate_value').text(extension_settings.rvc.rmsMixRate);

    $('#rvc_protect').val(extension_settings.rvc.protect);
    $('#rvc_protect_value').text(extension_settings.rvc.protect);

    $('#rvc_voice_map').val(extension_settings.rvc.voiceMapText);

    $('#rvc_api_source').val(extension_settings.rvc.source);
    $('#rvc_python_api_url').val(extension_settings.rvc.rvcPythonApiUrl);
    $('#rvc_python_cuda').prop('checked', extension_settings.rvc.rvcPythonCuda);

    switchSourceSettings();
}

async function onEnabledClick() {
    extension_settings.rvc.enabled = $('#rvc_enabled').is(':checked');
    saveSettingsDebounced();
}

async function onPitchExtractionChange() {
    extension_settings.rvc.pitchExtraction = $('#rvc_pitch_extraction').val();
    saveSettingsDebounced();
}

async function onIndexRateChange() {
    extension_settings.rvc.indexRate = Number($('#rvc_index_rate').val());
    $('#rvc_index_rate_value').text(extension_settings.rvc.indexRate);
    saveSettingsDebounced();
}

async function onFilterRadiusChange() {
    extension_settings.rvc.filterRadius = Number($('#rvc_filter_radius').val());
    $('#rvc_filter_radius_value').text(extension_settings.rvc.filterRadius);
    saveSettingsDebounced();
}

async function onPitchOffsetChange() {
    extension_settings.rvc.pitchOffset = Number($('#rvc_pitch_offset').val());
    $('#rvc_pitch_offset_value').text(extension_settings.rvc.pitchOffset);
    saveSettingsDebounced();
}

async function onRmsMixRateChange() {
    extension_settings.rvc.rmsMixRate = Number($('#rvc_rms_mix_rate').val());
    $('#rvc_rms_mix_rate_value').text(extension_settings.rvc.rmsMixRate);
    saveSettingsDebounced();
}

async function onProtectChange() {
    extension_settings.rvc.protect = Number($('#rvc_protect').val());
    $('#rvc_protect_value').text(extension_settings.rvc.protect);
    saveSettingsDebounced();
}

async function onApplyClick() {
    const character = String($('#rvc_character_select').val());
    const model_name = $('#rvc_model_select').val();
    const pitchExtraction = $('#rvc_pitch_extraction').val();
    const indexRate = $('#rvc_index_rate').val();
    const filterRadius = $('#rvc_filter_radius').val();
    const pitchOffset = $('#rvc_pitch_offset').val();
    const rmsMixRate = $('#rvc_rms_mix_rate').val();
    const protect = $('#rvc_protect').val();

    if (character === 'none') {
        toastr.error('Character not selected.', DEBUG_PREFIX + ' voice mapping apply', toastOptions);
        return;
    }

    if (model_name == 'none') {
        toastr.error('Model not selected.', DEBUG_PREFIX + ' voice mapping apply', toastOptions);
        return;
    }

    extension_settings.rvc.voiceMap[character] = {
        'modelName': model_name,
        'pitchExtraction': pitchExtraction,
        'indexRate': indexRate,
        'filterRadius': filterRadius,
        'pitchOffset': pitchOffset,
        'rmsMixRate': rmsMixRate,
        'protect': protect,
    };

    updateVoiceMapText();
    toastr.info('Settings saved.', DEBUG_PREFIX, { preventDuplicates: true });

    console.debug(DEBUG_PREFIX, 'Updated settings of ', character, ':', extension_settings.rvc.voiceMap[character]);
    saveSettingsDebounced();
}

async function onDeleteClick() {
    const character = String($('#rvc_character_select').val());

    if (character === 'none') {
        toastr.error('Character not selected.', DEBUG_PREFIX + ' voice mapping delete', toastOptions);
        return;
    }

    delete extension_settings.rvc.voiceMap[character];
    console.debug(DEBUG_PREFIX, 'Deleted settings of ', character);
    updateVoiceMapText();
    saveSettingsDebounced();
}

async function onChangeUploadFiles() {
    const inputFiles = $('#rvc_model_upload_files').get(0).files;
    await providers[extension_settings.rvc.source].uploadModels(inputFiles);
    await refreshVoiceList();
}

jQuery(async function () {
    async function addExtensionControls() {
        const settingsHtml = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
        const getContainer = () => $(document.getElementById('rvc_container') ?? document.getElementById('extensions_settings'));
        getContainer().append(settingsHtml);
        $('#rvc_enabled').on('click', onEnabledClick);
        $('#rvc_voice_map').attr('disabled', 'disabled');
        $('#rvc_pitch_extraction').on('change', onPitchExtractionChange);
        $('#rvc_index_rate').on('input', onIndexRateChange);
        $('#rvc_filter_radius').on('input', onFilterRadiusChange);
        $('#rvc_pitch_offset').on('input', onPitchOffsetChange);
        $('#rvc_rms_mix_rate').on('input', onRmsMixRateChange);
        $('#rvc_protect').on('input', onProtectChange);
        $('#rvc_apply').on('click', onApplyClick);
        $('#rvc_delete').on('click', onDeleteClick);

        $('#rvc_model_upload_files').hide();
        $('#rvc_model_upload_select_button').on('click', function () { $('#rvc_model_upload_files').click(); });

        $('#rvc_model_upload_files').on('change', onChangeUploadFiles);
        //$("#rvc_model_upload_button").on("click", onClickUpload);
        $('#rvc_model_refresh_button').on('click', refreshVoiceList);

        $('#rvc_api_source').on('change', function () {
            extension_settings.rvc.source = String($('#rvc_api_source').val());
            switchSourceSettings();
            refreshVoiceList();
            saveSettingsDebounced();
        });

        $('#rvc_python_api_url').on('input', function () {
            extension_settings.rvc.rvcPythonApiUrl = String($('#rvc_python_api_url').val());
            saveSettingsDebounced();
        });

        $('#rvc_python_cuda').on('input', function () {
            extension_settings.rvc.rvcPythonCuda = $('#rvc_python_cuda').is(':checked');
            saveSettingsDebounced();
        });
    }
    await addExtensionControls(); // No init dependencies
    loadSettings(); // Depends on Extension Controls

    // Update if the chat is changed
    eventSource.on(event_types.CHAT_CHANGED, moduleWorker);
    // Update if the current persona is changed
    eventSource.on(event_types.SETTINGS_UPDATED, moduleWorker);
    // Update if the character page is loaded (happens on import/creation)
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, moduleWorker);
    // Update if the extras are connected
    eventSource.on(event_types.EXTRAS_CONNECTED, moduleWorker);
    moduleWorker();
});

function switchSourceSettings() {
    document.querySelectorAll('#rvc_settings [data-rvc-source]').forEach((el) => {
        el.style.display = el.getAttribute('data-rvc-source') === extension_settings.rvc.source ? 'block' : 'none';
    });
}

//#############################//
//  API Calls                  //
//#############################//

/*
    Send an audio file to RVC to convert voice
*/
async function rvcVoiceConversion(response, character, text) {
    // Check voice map
    if (extension_settings.rvc.voiceMap[character] === undefined) {
        console.info(DEBUG_PREFIX, 'No RVC model assign in voice map for current character ' + character);
        return response;
    }

    // Re-fetch response if it's a URL
    if (typeof response === 'string') {
        response = await fetch(response);
        if (!response.ok) {
            throw `RVC received HTTP response with status ${response.status}`;
        }
    }

    const audioData = await response.blob();
    if (!audioData.type.startsWith('audio/')) {
        throw `RVC received HTTP response with invalid data format. Expecting audio/*, got ${audioData.type}`;
    }
    console.log('Audio type received:', audioData.type);

    const voiceSettings = extension_settings.rvc.voiceMap[character];

    try {
        // Create a converted voice response
        const provider = providers[extension_settings.rvc.source];
        const apiResult = await provider.convertVoice(audioData, voiceSettings);
        return apiResult;
    } catch (error) {
        // Return original response if conversion failed
        console.error(DEBUG_PREFIX, 'RVC Voice Conversion Failed:', error);
        return response;
    }
}

window['rvcVoiceConversion'] = rvcVoiceConversion;

//#############################//
//  Module Worker              //
//#############################//

async function refreshVoiceList() {
    const provider = providers[extension_settings.rvc.source];
    const isProviderValid = provider.verifySource(false);

    if (!isProviderValid) {
        return;
    }

    const result = await provider.getModelsList();
    rvcModelsList = result['models_list'];

    $('#rvc_model_select')
        .find('option')
        .remove()
        .end()
        .append('<option value="none">Select Voice</option>')
        .val('none');

    for (const modelName of rvcModelsList) {
        $('#rvc_model_select').append(new Option(modelName, modelName));
    }

    rvcModelsReceived = true;
    console.debug(DEBUG_PREFIX, 'Updated model list to:', rvcModelsList);
}

async function moduleWorker() {
    updateCharactersList();

    try {
        const provider = providers[extension_settings.rvc.source];
        const isProviderValid = provider.verifySource(false);

        if (isProviderValid && !rvcModelsReceived) {
            refreshVoiceList();
        }
    } catch {
        // Ignore errors
    }
}

function updateCharactersList() {
    let characterNames = new Set();
    const context = getContext();
    for (const i of context.characters) {
        characterNames.add(i.name);
    }

    const currentCharacters = Array.from(characterNames);
    currentCharacters.sort((a, b) => a.localeCompare(b));
    currentCharacters.unshift(context.name1);

    if (JSON.stringify(charactersList) !== JSON.stringify(currentCharacters)) {
        charactersList = currentCharacters;

        $('#rvc_character_select')
            .find('option')
            .remove()
            .end()
            .append('<option value="none">Select Character</option>')
            .val('none');

        for (const charName of charactersList) {
            $('#rvc_character_select').append(new Option(charName, charName));
        }

        console.debug(DEBUG_PREFIX, 'Updated character list to:', charactersList);
    }
}
