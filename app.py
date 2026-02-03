#!/usr/bin/env python3
"""
Monitoring Scout - A Server Monitoring System
Author: AI Assistant
Description: Monitor multiple hosts via SSH with real-time dashboard and web terminal
"""

import os
import json
import uuid
import hashlib
import asyncio
import threading
import time
import logging
from datetime import datetime
from functools import wraps

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, disconnect
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import check_password_hash, generate_password_hash
import paramiko
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Flask App Configuration
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'default-secret-key')
app.config['SESSION_TYPE'] = 'filesystem'

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# Initialize SocketIO - use threaded mode for better compatibility
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', logger=False, engineio_logger=False)

# Data Files
HOSTS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'hosts.json')

# In-memory storage for hosts (loaded from JSON)
hosts_data_cache = {"hosts": []}
hosts_lock = threading.Lock()

# Active SSH sessions for terminal
active_ssh_sessions = {}
monitoring_threads = {}

# ============== User Authentication ==============

class User(UserMixin):
    def __init__(self, username):
        self.id = username
        self.username = username

@login_manager.user_loader
def load_user(user_id):
    if user_id == os.getenv('ADMIN_USERNAME', 'admin'):
        return User(user_id)
    return None

# ============== Host Management ==============

def load_hosts():
    """Load hosts from JSON file"""
    global hosts_data_cache
    if not os.path.exists(HOSTS_FILE):
        return {"hosts": []}
    try:
        with open(HOSTS_FILE, 'r') as f:
            data = json.load(f)
            with hosts_lock:
                hosts_data_cache = data
            return data
    except Exception as e:
        logger.error(f"Error loading hosts: {e}")
        return {"hosts": []}

def save_hosts(data):
    """Save hosts to JSON file"""
    try:
        with hosts_lock:
            global hosts_data_cache
            hosts_data_cache = data
            with open(HOSTS_FILE, 'w') as f:
                json.dump(data, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving hosts: {e}")
        return False

def generate_host_id():
    """Generate unique host ID"""
    return f"host-{uuid.uuid4().hex[:8]}"

# ============== SSH Monitoring ==============

def check_host_status(host):
    """Check if host is reachable via SSH"""
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=host['ip'],
            port=host.get('port', 22),
            username=host['username'],
            password=host['password'],
            timeout=int(os.getenv('SSH_TIMEOUT', 10)),
            allow_agent=False,
            look_for_keys=False
        )
        client.close()
        return True
    except Exception as e:
        logger.debug(f"Host {host.get('ip')} check failed: {e}")
        return False

def get_system_metrics(host):
    """Get CPU, RAM, Disk metrics from host via SSH"""
    metrics = {
        'cpu_percent': 0,
        'memory_percent': 0,
        'memory_used': 'N/A',
        'memory_total': 'N/A',
        'disk_percent': 0,
        'disk_used': 'N/A',
        'disk_total': 'N/A',
        'uptime': 'N/A',
        'load_avg': [0, 0, 0],
        'status': 'offline',
        'error': None
    }
    
    client = None
    try:
        logger.info(f"Connecting to {host['ip']} as {host['username']}")
        
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=host['ip'],
            port=host.get('port', 22),
            username=host['username'],
            password=host['password'],
            timeout=int(os.getenv('SSH_TIMEOUT', 10)),
            allow_agent=False,
            look_for_keys=False
        )
        
        # Get CPU usage - try multiple methods
        cpu_percent = 0
        try:
            # Method 1: top command
            stdin, stdout, stderr = client.exec_command(
                "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\([0-9.]*\)%* id.*/\1/' | awk '{print 100 - $1}'"
            )
            cpu_output = stdout.read().decode().strip()
            if cpu_output and float(cpu_output) > 0:
                cpu_percent = round(float(cpu_output), 1)
            else:
                # Method 2: /proc/stat
                stdin, stdout, stderr = client.exec_command(
                    "grep 'cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$4+$5)} END {printf \"%.1f\", usage}'"
                )
                cpu_output = stdout.read().decode().strip()
                if cpu_output:
                    cpu_percent = round(float(cpu_output), 1)
        except Exception as e:
            logger.debug(f"CPU check error: {e}")
        
        metrics['cpu_percent'] = cpu_percent
        
        # Get Memory usage
        try:
            stdin, stdout, stderr = client.exec_command(
                "free | grep Mem | awk '{printf \"%.1f\", $3/$2 * 100.0}'"
            )
            mem_percent = stdout.read().decode().strip()
            if mem_percent:
                metrics['memory_percent'] = round(float(mem_percent), 1)
            
            # Get Memory details
            stdin, stdout, stderr = client.exec_command(
                "free -h | grep Mem | awk '{print $2, $3}'"
            )
            mem_details = stdout.read().decode().strip().split()
            if len(mem_details) >= 2:
                metrics['memory_total'] = mem_details[0]
                metrics['memory_used'] = mem_details[1]
        except Exception as e:
            logger.debug(f"Memory check error: {e}")
        
        # Get Disk usage
        try:
            stdin, stdout, stderr = client.exec_command(
                "df -h / | tail -1 | awk '{print $2, $3, $5}'"
            )
            disk_output = stdout.read().decode().strip().split()
            if len(disk_output) >= 3:
                metrics['disk_total'] = disk_output[0]
                metrics['disk_used'] = disk_output[1]
                metrics['disk_percent'] = int(disk_output[2].replace('%', ''))
        except Exception as e:
            logger.debug(f"Disk check error: {e}")
        
        # Get Uptime
        try:
            stdin, stdout, stderr = client.exec_command("uptime -p")
            uptime = stdout.read().decode().strip()
            if uptime:
                metrics['uptime'] = uptime.replace('up ', '')
            else:
                # Alternative uptime command
                stdin, stdout, stderr = client.exec_command("cat /proc/uptime | awk '{print $1}'")
                uptime_secs = stdout.read().decode().strip()
                if uptime_secs:
                    days = int(float(uptime_secs) / 86400)
                    hours = int((float(uptime_secs) % 86400) / 3600)
                    minutes = int((float(uptime_secs) % 3600) / 60)
                    metrics['uptime'] = f"{days}d {hours}h {minutes}m"
        except Exception as e:
            logger.debug(f"Uptime check error: {e}")
        
        # Get Load Average
        try:
            stdin, stdout, stderr = client.exec_command("uptime | awk -F'load average:' '{print $2}'")
            load_avg = stdout.read().decode().strip()
            if load_avg:
                load_parts = load_avg.replace(',', ' ').split()
                if len(load_parts) >= 3:
                    metrics['load_avg'] = [float(load_parts[0]), float(load_parts[1]), float(load_parts[2])]
        except Exception as e:
            logger.debug(f"Load check error: {e}")
        
        metrics['status'] = 'online'
        logger.info(f"Successfully got metrics from {host['ip']}: CPU={cpu_percent}%")
        
    except paramiko.AuthenticationException as e:
        metrics['error'] = f"Authentication failed: {str(e)}"
        logger.error(f"SSH auth error for {host.get('ip', 'unknown')}: {e}")
    except paramiko.SSHException as e:
        metrics['error'] = f"SSH error: {str(e)}"
        logger.error(f"SSH error for {host.get('ip', 'unknown')}: {e}")
    except Exception as e:
        metrics['error'] = str(e)
        logger.error(f"Connection error for {host.get('ip', 'unknown')}: {e}")
    finally:
        if client:
            try:
                client.close()
            except:
                pass
    
    return metrics

def monitor_single_host(host):
    """Monitor a single host and update its metrics"""
    try:
        metrics = get_system_metrics(host)
        
        # Update in-memory data
        with hosts_lock:
            for h in hosts_data_cache['hosts']:
                if h['id'] == host['id']:
                    h['metrics'] = metrics
                    h['last_check'] = datetime.now().isoformat()
                    break
        
        # Emit update via WebSocket
        socketio.emit('host_update', {
            'host_id': host['id'],
            'metrics': metrics,
            'last_check': datetime.now().isoformat()
        }, namespace='/monitor')
        
        return metrics
    except Exception as e:
        logger.error(f"Error monitoring host {host.get('ip')}: {e}")
        return None

def monitor_hosts_background():
    """Background thread to monitor all hosts"""
    logger.info("Starting background monitoring thread")
    
    while True:
        try:
            # Reload hosts from file to pick up any changes
            load_hosts()
            
            hosts_list = list(hosts_data_cache.get('hosts', []))
            logger.info(f"Monitoring {len(hosts_list)} hosts")
            
            for host in hosts_list:
                try:
                    monitor_single_host(host)
                except Exception as e:
                    logger.error(f"Error monitoring {host.get('ip')}: {e}")
                
                # Small delay between hosts to avoid overwhelming
                time.sleep(0.5)
            
            # Save updated data to file
            with hosts_lock:
                try:
                    with open(HOSTS_FILE, 'w') as f:
                        json.dump(hosts_data_cache, f, indent=2)
                except Exception as e:
                    logger.error(f"Error saving hosts: {e}")
            
        except Exception as e:
            logger.error(f"Monitoring loop error: {e}")
        
        time.sleep(5)  # Update every 5 seconds

# ============== Routes ==============

@app.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('login'))
    return redirect(url_for('dashboard'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        admin_user = os.getenv('ADMIN_USERNAME', 'admin')
        admin_pass = os.getenv('ADMIN_PASSWORD', 'monitoring123')
        
        if username == admin_user and password == admin_pass:
            user = User(username)
            login_user(user, remember=True)
            return redirect(url_for('dashboard'))
        else:
            return render_template('login.html', error='Invalid credentials')
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')

@app.route('/terminal/<host_id>')
@login_required
def terminal(host_id):
    hosts_data = load_hosts()
    host = next((h for h in hosts_data.get('hosts', []) if h['id'] == host_id), None)
    if not host:
        return "Host not found", 404
    return render_template('terminal.html', host=host)

# ============== API Routes ==============

@app.route('/api/hosts', methods=['GET'])
@login_required
def get_hosts():
    """Get all hosts with current metrics"""
    # Return from in-memory cache for better performance
    with hosts_lock:
        hosts_list = list(hosts_data_cache.get('hosts', []))
    
    # Don't send passwords to frontend
    safe_hosts = []
    for host in hosts_list:
        safe_host = {k: v for k, v in host.items() if k != 'password'}
        safe_hosts.append(safe_host)
    
    return jsonify({'hosts': safe_hosts})

@app.route('/api/hosts', methods=['POST'])
@login_required
def add_host():
    """Add a new host"""
    try:
        data = request.json
        logger.info(f"Adding new host: {data.get('name')} ({data.get('ip')})")
        
        # Validate required fields
        if not data.get('name') or not data.get('ip') or not data.get('username') or not data.get('password'):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
        new_host = {
            'id': generate_host_id(),
            'name': data.get('name'),
            'ip': data.get('ip'),
            'username': data.get('username'),
            'password': data.get('password'),
            'port': int(data.get('port', 22)),
            'description': data.get('description', ''),
            'group': data.get('group', 'Default'),
            'metrics': {'status': 'checking', 'cpu_percent': 0, 'memory_percent': 0, 'disk_percent': 0},
            'last_check': datetime.now().isoformat()
        }
        
        # Add to in-memory cache
        with hosts_lock:
            hosts_data_cache['hosts'].append(new_host)
            # Save to file
            try:
                with open(HOSTS_FILE, 'w') as f:
                    json.dump(hosts_data_cache, f, indent=2)
            except Exception as e:
                logger.error(f"Error saving hosts: {e}")
                return jsonify({'success': False, 'error': 'Failed to save host'}), 500
        
        logger.info(f"Host added with ID: {new_host['id']}")
        
        # Immediately check the new host in a background thread
        def check_new_host():
            time.sleep(0.5)  # Small delay to let the response return first
            logger.info(f"Running initial check for new host {new_host['ip']}")
            metrics = get_system_metrics(new_host)
            
            # Update the host with metrics
            with hosts_lock:
                for h in hosts_data_cache['hosts']:
                    if h['id'] == new_host['id']:
                        h['metrics'] = metrics
                        h['last_check'] = datetime.now().isoformat()
                        break
                
                # Save to file
                try:
                    with open(HOSTS_FILE, 'w') as f:
                        json.dump(hosts_data_cache, f, indent=2)
                except Exception as e:
                    logger.error(f"Error saving hosts after check: {e}")
            
            # Emit update
            socketio.emit('host_update', {
                'host_id': new_host['id'],
                'metrics': metrics,
                'last_check': datetime.now().isoformat()
            }, namespace='/monitor')
            
            logger.info(f"Initial check complete for {new_host['ip']}: {metrics['status']}")
        
        check_thread = threading.Thread(target=check_new_host)
        check_thread.daemon = True
        check_thread.start()
        
        # Return without password
        safe_host = {k: v for k, v in new_host.items() if k != 'password'}
        return jsonify({'success': True, 'host': safe_host})
        
    except Exception as e:
        logger.error(f"Error adding host: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/hosts/<host_id>', methods=['PUT'])
@login_required
def update_host(host_id):
    """Update a host"""
    try:
        data = request.json
        
        with hosts_lock:
            host = next((h for h in hosts_data_cache['hosts'] if h['id'] == host_id), None)
            if not host:
                return jsonify({'success': False, 'error': 'Host not found'}), 404
            
            host['name'] = data.get('name', host['name'])
            host['ip'] = data.get('ip', host['ip'])
            host['username'] = data.get('username', host['username'])
            if data.get('password'):
                host['password'] = data.get('password')
            host['port'] = int(data.get('port', host.get('port', 22)))
            host['description'] = data.get('description', host.get('description', ''))
            host['group'] = data.get('group', host.get('group', 'Default'))
            
            # Save to file
            try:
                with open(HOSTS_FILE, 'w') as f:
                    json.dump(hosts_data_cache, f, indent=2)
            except Exception as e:
                logger.error(f"Error saving hosts: {e}")
                return jsonify({'success': False, 'error': 'Failed to save'}), 500
            
            safe_host = {k: v for k, v in host.items() if k != 'password'}
        
        # Check the updated host
        def check_updated_host():
            time.sleep(0.5)
            monitor_single_host(host)
        
        check_thread = threading.Thread(target=check_updated_host)
        check_thread.daemon = True
        check_thread.start()
        
        return jsonify({'success': True, 'host': safe_host})
        
    except Exception as e:
        logger.error(f"Error updating host: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/hosts/<host_id>', methods=['DELETE'])
@login_required
def delete_host(host_id):
    """Delete a host"""
    try:
        with hosts_lock:
            hosts_data_cache['hosts'] = [h for h in hosts_data_cache['hosts'] if h['id'] != host_id]
            
            # Save to file
            try:
                with open(HOSTS_FILE, 'w') as f:
                    json.dump(hosts_data_cache, f, indent=2)
            except Exception as e:
                logger.error(f"Error saving hosts: {e}")
                return jsonify({'success': False, 'error': 'Failed to save'}), 500
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"Error deleting host: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/hosts/<host_id>/check', methods=['POST'])
@login_required
def check_host(host_id):
    """Check a specific host status"""
    with hosts_lock:
        host = next((h for h in hosts_data_cache['hosts'] if h['id'] == host_id), None)
    
    if not host:
        return jsonify({'success': False, 'error': 'Host not found'}), 404
    
    metrics = monitor_single_host(host)
    return jsonify({'success': True, 'metrics': metrics})

@app.route('/api/hosts/<host_id>/metrics', methods=['GET'])
@login_required
def get_host_metrics(host_id):
    """Get current metrics for a host"""
    with hosts_lock:
        host = next((h for h in hosts_data_cache['hosts'] if h['id'] == host_id), None)
    
    if not host:
        return jsonify({'success': False, 'error': 'Host not found'}), 404
    
    # Get fresh metrics
    metrics = get_system_metrics(host)
    
    # Update in-memory
    with hosts_lock:
        for h in hosts_data_cache['hosts']:
            if h['id'] == host_id:
                h['metrics'] = metrics
                h['last_check'] = datetime.now().isoformat()
                break
    
    return jsonify({'success': True, 'metrics': metrics})

# ============== WebSocket Terminal ==============

@socketio.on('connect', namespace='/terminal')
def terminal_connect():
    logger.info('Terminal client connected')

@socketio.on('disconnect', namespace='/terminal')
def terminal_disconnect():
    logger.info('Terminal client disconnected')
    # Clean up SSH sessions
    for sid, session in list(active_ssh_sessions.items()):
        if session.get('socket_id') == request.sid:
            try:
                session['client'].close()
            except:
                pass
            del active_ssh_sessions[sid]

@socketio.on('init_terminal', namespace='/terminal')
def init_terminal(data):
    """Initialize SSH terminal session"""
    host_id = data.get('host_id')
    
    with hosts_lock:
        host = next((h for h in hosts_data_cache.get('hosts', []) if h['id'] == host_id), None)
    
    if not host:
        emit('terminal_error', {'error': 'Host not found'})
        return
    
    try:
        logger.info(f"Opening terminal for {host['ip']}")
        
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=host['ip'],
            port=host.get('port', 22),
            username=host['username'],
            password=host['password'],
            timeout=10,
            allow_agent=False,
            look_for_keys=False
        )
        
        # Create interactive shell
        channel = client.invoke_shell(term='xterm', width=80, height=24)
        channel.settimeout(0.1)
        
        session_id = str(uuid.uuid4())
        active_ssh_sessions[session_id] = {
            'client': client,
            'channel': channel,
            'socket_id': request.sid,
            'host_id': host_id
        }
        
        emit('terminal_ready', {'session_id': session_id})
        logger.info(f"Terminal ready for {host['ip']}, session: {session_id}")
        
        # Start reading output
        def read_output():
            while session_id in active_ssh_sessions:
                try:
                    if channel.recv_ready():
                        data = channel.recv(4096).decode('utf-8', errors='replace')
                        socketio.emit('terminal_output', {'data': data}, namespace='/terminal', room=request.sid)
                    time.sleep(0.01)
                except Exception as e:
                    logger.error(f"Terminal read error: {e}")
                    break
            
            # Cleanup
            try:
                if session_id in active_ssh_sessions:
                    del active_ssh_sessions[session_id]
                client.close()
            except:
                pass
            
            logger.info(f"Terminal session {session_id} ended")
        
        thread = threading.Thread(target=read_output)
        thread.daemon = True
        thread.start()
        
    except paramiko.AuthenticationException as e:
        logger.error(f"Terminal auth error for {host.get('ip')}: {e}")
        emit('terminal_error', {'error': f'Authentication failed: {str(e)}'})
    except Exception as e:
        logger.error(f"Terminal error for {host.get('ip')}: {e}")
        emit('terminal_error', {'error': str(e)})

@socketio.on('terminal_input', namespace='/terminal')
def terminal_input(data):
    """Handle terminal input"""
    session_id = data.get('session_id')
    input_data = data.get('data')
    
    if session_id in active_ssh_sessions:
        session = active_ssh_sessions[session_id]
        try:
            session['channel'].send(input_data)
        except Exception as e:
            emit('terminal_error', {'error': str(e)})

@socketio.on('resize_terminal', namespace='/terminal')
def resize_terminal(data):
    """Handle terminal resize"""
    session_id = data.get('session_id')
    cols = data.get('cols', 80)
    rows = data.get('rows', 24)
    
    if session_id in active_ssh_sessions:
        session = active_ssh_sessions[session_id]
        try:
            session['channel'].resize_pty(width=cols, height=rows)
        except:
            pass

@socketio.on('connect', namespace='/monitor')
def monitor_connect():
    logger.info('Monitor client connected')
    emit('connected', {'message': 'Connected to monitoring'})

@socketio.on('disconnect', namespace='/monitor')
def monitor_disconnect():
    logger.info('Monitor client disconnected')

# ============== Main ==============

if __name__ == '__main__':
    # Load hosts on startup
    load_hosts()
    logger.info(f"Loaded {len(hosts_data_cache.get('hosts', []))} hosts")
    
    # Start background monitoring thread
    monitor_thread = threading.Thread(target=monitor_hosts_background)
    monitor_thread.daemon = True
    monitor_thread.start()
    
    # Run the Flask app
    port = int(os.getenv('FLASK_PORT', 5000))
    logger.info(f"Starting Monitoring Scout on port {port}")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)
