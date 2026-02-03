/**
 * Monitoring Scout - Terminal JavaScript
 * Web-based SSH Terminal using xterm.js
 */

let term = null;
let socket = null;
let fitAddon = null;
let sessionId = null;
let isConnected = false;

// Initialize terminal when page loads
document.addEventListener('DOMContentLoaded', () => {
    initTerminal();
    initSocket();
});

// Initialize xterm.js terminal
function initTerminal() {
    const terminalContainer = document.getElementById('terminal');
    
    if (!terminalContainer) {
        console.error('Terminal container not found');
        return;
    }
    
    try {
        // Create terminal instance
        term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", monospace',
            theme: {
                background: '#0d1117',
                foreground: '#e6edf3',
                cursor: '#e6edf3',
                selectionBackground: '#264f78',
                black: '#0d1117',
                red: '#ff7b72',
                green: '#3fb950',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#39c5cf',
                white: '#e6edf3',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#56d4dd',
                brightWhite: '#ffffff'
            },
            scrollback: 10000,
            cols: 80,
            rows: 24
        });
        
        // Add fit addon
        fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        
        // Open terminal in container
        term.open(terminalContainer);
        fitAddon.fit();
        
        // Handle terminal input
        term.onData((data) => {
            if (socket && isConnected && sessionId) {
                socket.emit('terminal_input', {
                    session_id: sessionId,
                    data: data
                });
            }
        });
        
        // Handle resize
        window.addEventListener('resize', () => {
            if (fitAddon) {
                fitAddon.fit();
                if (socket && isConnected && sessionId) {
                    socket.emit('resize_terminal', {
                        session_id: sessionId,
                        cols: term.cols,
                        rows: term.rows
                    });
                }
            }
        });
        
        // Initial connection message
        term.writeln('\r\n\x1b[1;36m╔══════════════════════════════════════════════════════════╗\x1b[0m');
        term.writeln('\x1b[1;36m║\x1b[0m     \x1b[1;34m🔌 Monitoring Scout - Web Terminal\x1b[0m                  \x1b[1;36m║\x1b[0m');
        term.writeln('\x1b[1;36m╚══════════════════════════════════════════════════════════╝\x1b[0m\r\n');
        term.writeln(`\x1b[90mConnecting to ${hostName} (${hostIp})...\x1b[0m\r\n`);
        
    } catch (error) {
        console.error('Error initializing terminal:', error);
        terminalContainer.innerHTML = '<div style="color: red; padding: 20px;">Error initializing terminal. Please refresh the page.</div>';
    }
}

// Initialize Socket.IO connection
function initSocket() {
    const statusDot = document.getElementById('status-dot');
    const connectionStatus = document.getElementById('connection-status');
    const connectionMessage = document.getElementById('connection-message');
    
    if (!statusDot || !connectionStatus) {
        console.error('Status elements not found');
        return;
    }
    
    try {
        socket = io('/terminal');
        
        socket.on('connect', () => {
            console.log('Connected to terminal socket');
            
            // Initialize SSH session
            socket.emit('init_terminal', { host_id: hostId });
        });
        
        socket.on('terminal_ready', (data) => {
            sessionId = data.session_id;
            isConnected = true;
            
            // Update UI
            statusDot.style.background = '#3fb950';
            statusDot.style.boxShadow = '0 0 10px #3fb950';
            connectionStatus.textContent = 'Connected';
            connectionStatus.style.color = '#3fb950';
            if (connectionMessage) {
                connectionMessage.classList.remove('show');
            }
            
            // Clear the connecting message and show connected
            term.writeln('\x1b[32m✓ Connected successfully!\x1b[0m\r\n');
            
            // Send initial resize
            socket.emit('resize_terminal', {
                session_id: sessionId,
                cols: term.cols,
                rows: term.rows
            });
        });
        
        socket.on('terminal_output', (data) => {
            if (term && data.data) {
                term.write(data.data);
            }
        });
        
        socket.on('terminal_error', (data) => {
            console.error('Terminal error:', data.error);
            
            isConnected = false;
            statusDot.style.background = '#f85149';
            statusDot.style.boxShadow = 'none';
            connectionStatus.textContent = 'Connection Failed';
            connectionStatus.style.color = '#f85149';
            if (connectionMessage) {
                connectionMessage.classList.remove('show');
            }
            
            term.writeln('\r\n');
            term.writeln('\x1b[1;31m╔══════════════════════════════════════════════════════════╗\x1b[0m');
            term.writeln('\x1b[1;31m║\x1b[0m  \x1b[1;31m✗ Connection Failed\x1b[0m                                    \x1b[1;31m║\x1b[0m');
            term.writeln('\x1b[1;31m╚══════════════════════════════════════════════════════════╝\x1b[0m');
            term.writeln(`\r\n\x1b[31mError: ${data.error}\x1b[0m\r\n`);
            term.writeln('\x1b[90mPossible causes:\x1b[0m');
            term.writeln('  \x1b[90m• Incorrect username or password\x1b[0m');
            term.writeln('  \x1b[90m• SSH service not running on target host\x1b[0m');
            term.writeln('  \x1b[90m• Firewall blocking SSH port\x1b[0m');
            term.writeln('  \x1b[90m• Host is unreachable\x1b[0m');
            term.writeln('\r\n\x1b[90mClick "Reconnect" to try again.\x1b[0m\r\n');
        });
        
        socket.on('disconnect', () => {
            console.log('Disconnected from terminal socket');
            
            isConnected = false;
            statusDot.style.background = '#f0883e';
            statusDot.style.boxShadow = 'none';
            connectionStatus.textContent = 'Disconnected';
            connectionStatus.style.color = '#f0883e';
            
            term.writeln('\r\n\x1b[1;33m⚠ Connection closed by server.\x1b[0m\r\n');
        });
        
        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            
            statusDot.style.background = '#f85149';
            statusDot.style.boxShadow = 'none';
            connectionStatus.textContent = 'Connection Error';
            connectionStatus.style.color = '#f85149';
            if (connectionMessage) {
                connectionMessage.classList.remove('show');
            }
            
            term.writeln('\r\n\x1b[1;31m✗ Socket connection error. Please refresh the page.\x1b[0m\r\n');
        });
        
    } catch (error) {
        console.error('Error initializing socket:', error);
        term.writeln('\r\n\x1b[1;31m✗ Failed to initialize connection.\x1b[0m\r\n');
    }
}

// Reconnect function
function reconnect() {
    const statusDot = document.getElementById('status-dot');
    const connectionStatus = document.getElementById('connection-status');
    const connectionMessage = document.getElementById('connection-message');
    
    if (!socket) {
        console.error('Socket not initialized');
        return;
    }
    
    // Reset terminal
    term.clear();
    term.writeln('\r\n\x1b[1;36m╔══════════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[1;36m║\x1b[0m     \x1b[1;34m🔌 Monitoring Scout - Web Terminal\x1b[0m                  \x1b[1;36m║\x1b[0m');
    term.writeln('\x1b[1;36m╚══════════════════════════════════════════════════════════╝\x1b[0m\r\n');
    term.writeln(`\x1b[90mReconnecting to ${hostName} (${hostIp})...\x1b[0m\r\n`);
    
    // Update UI
    statusDot.style.background = '#f0883e';
    statusDot.style.boxShadow = 'none';
    connectionStatus.textContent = 'Reconnecting...';
    connectionStatus.style.color = '#f0883e';
    if (connectionMessage) {
        connectionMessage.classList.add('show');
    }
    
    // Reset state
    isConnected = false;
    sessionId = null;
    
    // Disconnect and reconnect
    socket.disconnect();
    
    setTimeout(() => {
        socket.connect();
    }, 500);
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (socket) {
        socket.disconnect();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+L to clear terminal
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        if (term) {
            term.clear();
        }
    }
    
    // Ctrl+R to reconnect
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        reconnect();
    }
    
    // Ctrl+C - if not connected, stop reconnect attempts
    if (e.ctrlKey && e.key === 'c' && !isConnected) {
        term.writeln('^C');
    }
});

// Handle paste
document.addEventListener('paste', (e) => {
    if (term && isConnected && sessionId) {
        const text = e.clipboardData.getData('text');
        if (text) {
            socket.emit('terminal_input', {
                session_id: sessionId,
                data: text
            });
        }
    }
});
