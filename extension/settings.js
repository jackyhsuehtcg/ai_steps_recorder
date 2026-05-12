// settings.js - AI Steps Recorder settings page

class SettingsManager {
  constructor() {
    this.defaultSettings = {
      provider: 'lmstudio',
      apiUrl: 'http://localhost:1234/v1/chat/completions',
      modelName: 'lm-studio',
      apiKey: '',
      temperature: 0.1,
      maxTokens: 2000
    };

    this.providers = {
      lmstudio: {
        name: 'LM Studio',
        apiUrl: 'http://localhost:1234/v1/chat/completions',
        models: ['lm-studio', 'llama-2-7b', 'llama-2-13b', 'codellama-7b'],
        defaultModel: 'lm-studio',
        requiresKey: false,
        parameterName: 'max_tokens'
      },
      openrouter: {
        name: 'OpenRouter',
        apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
        // Suggestion list shown via <datalist>; users may type any OpenRouter model id.
        models: [
          'anthropic/claude-sonnet-4',
          'anthropic/claude-3.7-sonnet',
          'openai/gpt-5',
          'openai/gpt-4o',
          'google/gemini-2.5-flash',
          'google/gemini-2.5-pro',
          'meta-llama/llama-3.3-70b-instruct',
          'deepseek/deepseek-chat'
        ],
        defaultModel: 'anthropic/claude-sonnet-4',
        requiresKey: true,
        parameterName: 'max_tokens',
        freeFormModel: true
      }
    };

    this.init();
  }

  async init() {
    // Load current settings
    await this.loadSettings();

    // Wire up form events
    this.bindEvents();

    console.log('Settings manager initialized');
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(this.defaultSettings);
      this.currentSettings = { ...this.defaultSettings, ...result };

      // Detect deprecated provider values, downgrade silently to LM Studio default,
      // and notify the user with a one-time inline message.
      const removedProviders = ['gemini', 'anthropic', 'openai', 'ollama'];
      if (removedProviders.includes(this.currentSettings.provider)) {
        const removedProvider = this.currentSettings.provider;
        this.currentSettings.provider = this.defaultSettings.provider;
        this.currentSettings.apiUrl = this.defaultSettings.apiUrl;
        this.currentSettings.modelName = this.defaultSettings.modelName;
        try {
          await chrome.storage.sync.set({
            provider: this.currentSettings.provider,
            apiUrl: this.currentSettings.apiUrl,
            modelName: this.currentSettings.modelName
          });
        } catch (e) {
          console.warn('Failed to persist provider downgrade:', e);
        }
        const removedNames = {
          gemini: 'Gemini',
          anthropic: 'Anthropic',
          openai: 'OpenAI',
          ollama: 'Ollama'
        };
        const removedName = removedNames[removedProvider] || removedProvider;
        const message = removedProvider === 'ollama'
          ? `Ollama is no longer supported. Switched back to LM Studio. To keep using Ollama, leave the provider as LM Studio and change the API URL to http://localhost:11434/v1/chat/completions.`
          : `${removedName} is no longer supported. Switched back to LM Studio. Please choose OpenRouter or another provider.`;
        this.showMessage(message, 'info');
      }

      // Populate the form with the (possibly downgraded) settings
      this.populateForm();
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.currentSettings = { ...this.defaultSettings };
      this.populateForm();
    }
  }

  populateForm() {
    document.getElementById('provider').value = this.currentSettings.provider || 'lmstudio';
    document.getElementById('apiUrl').value = this.currentSettings.apiUrl;
    document.getElementById('modelName').value = this.currentSettings.modelName;
    document.getElementById('apiKey').value = this.currentSettings.apiKey;
    document.getElementById('temperature').value = this.currentSettings.temperature;
    document.getElementById('maxTokens').value = this.currentSettings.maxTokens;

    // Update model options + provider-specific fields
    this.updateProviderFields(this.currentSettings.provider || 'lmstudio');
  }

  bindEvents() {
    // Provider switch
    document.getElementById('provider').addEventListener('change', (e) => {
      this.updateProviderFields(e.target.value);
    });

    // Form submit
    document.getElementById('settingsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSettings();
    });

    // Test connection
    document.getElementById('testButton').addEventListener('click', () => {
      this.testConnection();
    });

    // Live URL validation
    document.getElementById('apiUrl').addEventListener('input', (e) => {
      this.validateUrl(e.target);
    });
  }

  updateProviderFields(providerId) {
    if (!providerId || !this.providers[providerId]) {
      return;
    }

    const provider = this.providers[providerId];

    // Update API URL
    document.getElementById('apiUrl').value = provider.apiUrl;

    // Re-render the model name field based on provider.freeFormModel:
    //   true  -> <input type="text"> + <datalist> suggestions
    //   false -> <select> dropdown
    const modelNameInput = document.getElementById('modelName');
    const modelContainer = modelNameInput.parentElement;
    const modelHint = modelContainer.querySelector('.form-hint');

    // Remove the existing modelName element and any leftover datalist (avoid id collisions)
    modelNameInput.remove();
    const staleDatalist = modelContainer.querySelector('datalist[data-modelname-suggestions]');
    if (staleDatalist) staleDatalist.remove();

    // Preferred default value: keep the user's existing setting when staying on the same
    // provider, otherwise fall back to the provider's default model.
    const preferredValue = (this.currentSettings && this.currentSettings.provider === providerId
      ? this.currentSettings.modelName
      : '') || provider.defaultModel || '';

    if (provider.freeFormModel) {
      // Free-form text input with suggestion datalist
      const datalistId = `modelName-suggestions-${providerId}`;

      const modelInput = document.createElement('input');
      modelInput.type = 'text';
      modelInput.id = 'modelName';
      modelInput.name = 'modelName';
      modelInput.className = 'form-input';
      modelInput.required = true;
      modelInput.autocomplete = 'off';
      modelInput.spellcheck = false;
      modelInput.setAttribute('list', datalistId);
      modelInput.placeholder = `e.g. ${provider.defaultModel || ''}`;
      modelInput.value = preferredValue;

      const datalist = document.createElement('datalist');
      datalist.id = datalistId;
      datalist.dataset.modelnameSuggestions = '1';
      provider.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        datalist.appendChild(option);
      });

      modelContainer.insertBefore(modelInput, modelHint);
      modelContainer.insertBefore(datalist, modelHint);

      modelHint.textContent = `Enter any model id supported by ${provider.name}. Pick from the suggestions or type your own (e.g. ${provider.defaultModel || ''}).`;
    } else {
      // Default: <select> dropdown
      const modelSelect = document.createElement('select');
      modelSelect.id = 'modelName';
      modelSelect.name = 'modelName';
      modelSelect.className = 'form-input';
      modelSelect.required = true;

      provider.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        if (model === preferredValue) {
          option.selected = true;
        }
        modelSelect.appendChild(option);
      });

      modelContainer.insertBefore(modelSelect, modelHint);

      modelHint.textContent = `Choose a ${provider.name} model.`;
    }

    // Update API Key field hint and required state
    const apiKeyInput = document.getElementById('apiKey');
    const apiKeyHint = apiKeyInput.parentElement.querySelector('.form-hint');
    const apiKeyLabel = apiKeyInput.parentElement.querySelector('.form-label .label-text');

    if (provider.requiresKey) {
      apiKeyInput.required = true;
      apiKeyHint.textContent = `${provider.name} API key (required).`;
      apiKeyLabel.innerHTML = 'API Key <span class="label-required">*</span>';
    } else {
      apiKeyInput.required = false;
      apiKeyHint.textContent = `${provider.name} API key (optional; not required for local servers).`;
      apiKeyLabel.innerHTML = 'API Key';
    }
  }

  buildRequestBody(settings, content, maxTokens) {
    const provider = this.providers[settings.provider];
    if (!provider) {
      throw new Error('Unknown provider');
    }

    switch (settings.provider) {
      case 'lmstudio':
      case 'openrouter':
        const requestBody = {
          model: settings.modelName,
          messages: [{ role: "user", content: content }],
          [provider.parameterName]: maxTokens,
          stream: false
        };

        // Apply temperature
        requestBody.temperature = settings.temperature;

        return requestBody;

      default:
        throw new Error('Unsupported provider type');
    }
  }

  setAuthHeaders(headers, settings) {
    if (!settings.apiKey) return;

    switch (settings.provider) {
      case 'lmstudio':
      case 'openrouter':
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
        if (settings.provider === 'openrouter') {
          // OpenRouter recommends sending these two headers so third-party apps
          // appear in their dashboard rankings.
          try {
            headers['HTTP-Referer'] = `chrome-extension://${chrome.runtime.id}`;
          } catch (_) {}
          headers['X-Title'] = 'AI Steps Recorder';
        }
        break;
    }
  }

  validateUrl(input) {
    try {
      new URL(input.value);
      input.setCustomValidity('');
    } catch {
      if (input.value) {
        input.setCustomValidity('Please enter a valid URL.');
      } else {
        input.setCustomValidity('');
      }
    }
  }

  async saveSettings() {
    try {
      // Read form data
      const formData = new FormData(document.getElementById('settingsForm'));
      const settings = {
        provider: formData.get('provider').trim(),
        apiUrl: formData.get('apiUrl').trim(),
        modelName: formData.get('modelName').trim() || 'lm-studio',
        apiKey: formData.get('apiKey').trim(),
        temperature: parseFloat(formData.get('temperature')) || 0.1,
        maxTokens: parseInt(formData.get('maxTokens')) || 2000
      };

      // Validate API URL
      try {
        new URL(settings.apiUrl);
      } catch {
        this.showMessage('Please enter a valid API URL.', 'error');
        return;
      }

      // Persist to Chrome storage
      await chrome.storage.sync.set(settings);
      this.currentSettings = settings;

      this.showMessage('Settings saved successfully.', 'success');

      console.log('Settings saved:', settings);
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showMessage('Failed to save settings: ' + error.message, 'error');
    }
  }

  async testConnection() {
    const testButton = document.getElementById('testButton');
    const originalText = testButton.textContent;

    try {
      // Disable the button while the test is in flight
      testButton.disabled = true;
      testButton.textContent = '🔄 Testing...';

      // Read settings from the form
      const formData = new FormData(document.getElementById('settingsForm'));
      const settings = {
        provider: formData.get('provider').trim(),
        apiUrl: formData.get('apiUrl').trim(),
        modelName: formData.get('modelName').trim() || 'lm-studio',
        apiKey: formData.get('apiKey').trim(),
        temperature: parseFloat(formData.get('temperature')) || 0.1,
        maxTokens: parseInt(formData.get('maxTokens')) || 2000
      };

      // Provider-specific request body
      const requestBody = this.buildRequestBody(settings, "Connection test: please reply with 'OK'.", 50);

      const headers = {
        'Content-Type': 'application/json'
      };

      // Provider-specific auth headers
      this.setAuthHeaders(headers, settings);

      const apiUrl = settings.apiUrl;

      // Send the smoke-test request
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Could not read error response');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      // Provider-specific response parsing
      let responseContent = '';
      switch (settings.provider) {
        case 'lmstudio':
        case 'openrouter':
          if (!data.choices || data.choices.length === 0) {
            throw new Error('Unexpected API response: no choices field found.');
          }
          responseContent = data.choices[0].message?.content || 'Response received';
          break;

        default:
          responseContent = 'Response received';
      }

      // Success
      this.showTestResult('✅ Connection test succeeded!', 'success', `Response: ${responseContent}`);

    } catch (error) {
      console.error('Connection test failed:', error);
      let errorMessage = 'Connection test failed';

      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Cannot reach the server. Verify the URL is correct and the server is running.';
      } else {
        errorMessage = `Connection test failed: ${error.message}`;
      }

      this.showTestResult('❌ ' + errorMessage, 'error');
    } finally {
      // Restore button state
      testButton.disabled = false;
      testButton.textContent = originalText;
    }
  }

  showTestResult(message, type, detail = '') {
    const resultDiv = document.getElementById('testResult');
    const iconDiv = document.getElementById('testResultIcon');
    const messageDiv = document.getElementById('testResultMessage');

    // Set icon and message
    if (type === 'success') {
      iconDiv.textContent = '✅';
      messageDiv.innerHTML = `<strong>${message}</strong>${detail ? `<br><small>${detail}</small>` : ''}`;
      resultDiv.className = 'test-result test-result-success';
    } else {
      iconDiv.textContent = '❌';
      messageDiv.innerHTML = `<strong>${message}</strong>${detail ? `<br><small>${detail}</small>` : ''}`;
      resultDiv.className = 'test-result test-result-error';
    }

    // Show the result panel
    resultDiv.style.display = 'block';

    // Auto-hide success messages after a few seconds
    if (type === 'success') {
      setTimeout(() => {
        resultDiv.style.display = 'none';
      }, 5000);
    }
  }

  showMessage(message, type = 'info') {
    // Top-of-page transient toast
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <span>${message}</span>
      <button class="notification-close" onclick="this.parentElement.remove()">✖</button>
    `;

    // Insert at the top of the body
    document.body.insertBefore(notification, document.body.firstChild);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new SettingsManager();
});
