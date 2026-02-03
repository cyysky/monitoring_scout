# 🛰️ Monitoring Scout

A modern, real-time server monitoring system with SSH capabilities and web-based terminal access.

![Dashboard Preview](https://via.placeholder.com/800x450/161b22/e6edf3?text=Monitoring+Scout+Dashboard)

## ✨ Features

- **🔐 Secure Login** - Environment-based authentication
- **📊 Real-time Dashboard** - Live monitoring of CPU, RAM, Disk usage and uptime
- **🖥️ Multi-Host Support** - Monitor multiple servers from one interface
- **🌐 Web-based Terminal** - Full SSH terminal access through the browser
- **⚡ Real-time Updates** - WebSocket-powered live metrics updates
- **🎨 Modern Dark UI** - Clean, responsive interface
- **📱 Responsive Design** - Works on desktop and mobile devices
- **📝 Host Management** - Add, edit, and delete hosts via GUI

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- pip

### Installation

1. **Install dependencies:**
```bash
pip install -r requirements.txt
```

2. **Configure environment variables** (optional - defaults are provided):

Edit `.env` file:
```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
SECRET_KEY=your-secret-key
FLASK_PORT=5000
```

3. **Configure target hosts** in `data/hosts.json`:

```json
{
  "hosts": [
    {
      "id": "host-001",
      "name": "Web Server 01",
      "ip": "192.168.1.10",
      "username": "root",
      "password": "your_password",
      "port": 22,
      "description": "Production web server",
      "group": "Production"
    }
  ]
}
```

4. **Run the application:**

```bash
python app.py
```

5. **Access the dashboard:**

Open your browser and navigate to: `http://localhost:5000`

**Default credentials:**
- Username: `admin`
- Password: `monitoring123`

## 📖 Usage Guide

### Dashboard

The dashboard displays all your monitored hosts with:
- **Status indicator** - Online/Offline status
- **CPU usage** - Real-time CPU utilization with progress bar
- **Memory usage** - RAM consumption
- **Disk usage** - Storage utilization
- **Quick actions** - Terminal, edit, delete buttons

### Adding a Host

1. Click the **"Add Host"** button in the sidebar
2. Fill in the required fields:
   - Host Name
   - IP Address
   - Username
   - Password
3. Optional: Set a group name and description
4. Click **"Add Host"** to save

### Using the Terminal

1. Click the **terminal icon** (▶) on an online host card
2. A new window opens with an interactive SSH terminal
3. Use the terminal as you would with a normal SSH client
4. **Keyboard shortcuts:**
   - `Ctrl+L` - Clear terminal
   - `Ctrl+R` - Reconnect

### Managing Hosts

- **Edit**: Click the edit (✎) icon to modify host details
- **Delete**: Click the delete (🗑) icon to remove a host
- **Details**: Click the info (ℹ) icon to view full host information

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_USERNAME` | Login username | `admin` |
| `ADMIN_PASSWORD` | Login password | `monitoring123` |
| `SECRET_KEY` | Flask secret key | `monitoring-scout-secret-key-change-in-production` |
| `FLASK_PORT` | Server port | `5000` |
| `SSH_TIMEOUT` | SSH connection timeout | `10` |

### Host JSON Format

```json
{
  "hosts": [
    {
      "id": "unique-id",
      "name": "Display Name",
      "ip": "192.168.1.100",
      "username": "root",
      "password": "password",
      "port": 22,
      "description": "Optional description",
      "group": "Optional group"
    }
  ]
}
```

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hosts` | List all hosts |
| POST | `/api/hosts` | Add new host |
| PUT | `/api/hosts/<id>` | Update host |
| DELETE | `/api/hosts/<id>` | Delete host |
| POST | `/api/hosts/<id>/check` | Check host status |
| GET | `/api/hosts/<id>/metrics` | Get current metrics |

## 🔒 Security Notes

1. **Change default credentials** in production
2. **Use strong passwords** for both login and SSH access
3. **Keep the `.env` file secure** and never commit it to version control
4. **Use SSH keys** instead of passwords when possible (feature coming soon)
5. **Run behind a reverse proxy** (nginx) with HTTPS in production
6. **Restrict network access** to the monitoring system

## 🐛 Troubleshooting

### Connection Issues

- Verify SSH credentials in host configuration
- Ensure the target host allows SSH connections
- Check firewall settings on both ends

### Terminal Not Working

- Make sure the host is online
- Check browser console for JavaScript errors
- Try reconnecting with the reconnect button

### Metrics Not Updating

- Check if the host is reachable
- Verify SSH user has permission to run system commands
- Check application logs for errors

## 📝 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

**Monitoring Scout** - Keep your servers in sight 🛰️
