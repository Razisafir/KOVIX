// Construct Agent Panel — Webview Client
// Communicates with the extension host via VS Code webview API

const vscode = acquireVsCodeApi();
let isStreaming = false;

// ========== DOM References ==========
const inputEl = document.getElementById('input');
const sendBtnEl = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const actionsEl = document.getElementById('actions');
const acceptBtnEl = document.getElementById('acceptBtn');
const rejectBtnEl = document.getElementById('rejectBtn');

// ========== Send Message ==========
function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;

    addMessage('user', text);
    inputEl.value = '';
    isStreaming = true;
    updateStatus('thinking');
    sendBtnEl.disabled = true;

    vscode.postMessage({ type: 'sendMessage', text });
}

// ========== Add Message to Chat ==========
function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'message ' + role;
    div.innerHTML = formatContent(content);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ========== Format Content ==========
function formatContent(text) {
    return text
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

// ========== Update Status ==========
function updateStatus(status) {
    statusEl.className = 'status ' + status;
    const labels = {
        online: 'Ready',
        thinking: 'Thinking...',
        error: 'Error',
        offline: 'Offline'
    };
    statusEl.textContent = labels[status] || status;
}

// ========== Accept / Reject Changes ==========
function acceptChanges() {
    vscode.postMessage({ type: 'acceptChanges' });
}

function rejectChanges() {
    vscode.postMessage({ type: 'rejectChanges' });
}

// ========== Event Listeners ==========
sendBtnEl.addEventListener('click', sendMessage);

acceptBtnEl.addEventListener('click', acceptChanges);
rejectBtnEl.addEventListener('click', rejectChanges);

inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendMessage();
    }
});

// ========== Receive Messages from Extension Host ==========
window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
        case 'sessionStarted':
            updateStatus('thinking');
            break;

        case 'agentEvent':
            if (msg.event.type === 'thought') {
                addMessage('assistant', '[Thought] ' + msg.event.content);
            } else if (msg.event.type === 'action') {
                addMessage('assistant', '[Action] ' + msg.event.content);
            } else if (msg.event.type === 'observation') {
                addMessage('assistant', '[Result] ' + msg.event.content);
            } else if (msg.event.type === 'complete') {
                isStreaming = false;
                updateStatus('online');
                sendBtnEl.disabled = false;
                actionsEl.style.display = 'flex';
            }
            break;

        case 'userMessage':
            addMessage('user', msg.message.content);
            break;

        case 'error':
            addMessage('error', msg.message || 'Unknown error');
            isStreaming = false;
            updateStatus('error');
            sendBtnEl.disabled = false;
            break;

        case 'changesAccepted':
            addMessage('assistant', 'All changes accepted');
            actionsEl.style.display = 'none';
            break;

        case 'changesRejected':
            addMessage('assistant', 'All changes rejected');
            actionsEl.style.display = 'none';
            break;

        case 'historyLoaded':
            if (msg.messages) {
                msg.messages.forEach(m => addMessage(m.role, m.content));
            }
            break;

        case 'status':
            updateStatus(msg.status);
            break;

        case 'init':
            if (msg.backendUrl) {
                console.log('Construct backend:', msg.backendUrl);
            }
            break;
    }
});

// ========== Request History on Load ==========
vscode.postMessage({ type: 'getHistory' });
