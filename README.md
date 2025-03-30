# Homebridge Sonos Control Plugin

## ✨ Introduction

The **Homebridge Sonos Control Plugin** allows you to configure HomeKit switches to **play notifications (Notification Switches)** and **play tracks/streams (Track Switches)** on your Sonos devices.

## 🔧 Installation

Typically, you install the plugin via Homebridge's web UI.
For manual installation, use:

```sh
npm install -g homebridge-sonos-control
```

## 📄 Configuration

Configuration is done in `config.json`. There are two main functionalities:

- **Notification Switches**: Play short notification sounds (MP3/WAV).
- **Track Switches**: Play full tracks or streams.

### 📢 Example Configuration

```json
{
  "platform": "GlurzSonosControl",
  "notificationSwitches": [
    {
      "name": "Doorbell",
      "trackUri": "http://example.com/doorbell.mp3",
      "sonosDeviceNames": ["Living Room", "Hallway"],
      "volume": 30,
      "onlyWhenPlaying": true
    }
  ],
  "trackSwitches": [
    {
      "name": "Relaxing Music",
      "trackUri": "http://example.com/radio-stream.mp3",
      "sonosDeviceNames": ["Bedroom"],
      "volume": 20
    },
    {
      "name": "Short Extract",
      "trackUri": "spotify:track:3dPQuX8Gs42Y7b454ybpMR",
      "sonosDeviceNames": ["Kitchen"],
      "volume": 20,
      "seekPosition": "00:02:03",
      "stopAfter": 5
    }
  ]
}
```

## 📊 Configuration Options

### **Notification Switches**
Notifications use a native functionality of the Sonos speakers, in which a (short) notification is played, whereby the music currently playing is paused or, depending on the device, continues to play quietly in the background. After the notification, the previous status is restored.

| Field              | Type           | Description                                                         |
| ------------------ | -------------- | ------------------------------------------------------------------- |
| `name`             | string         | Name of the switch in HomeKit                                       |
| `trackUri`         | string (URL)   | The MP3 or WAV file to be played                                    |
| `sonosDeviceNames` | string[]       | Names of the Sonos devices that will play the notification          |
| `volume`           | number (1-100) | Volume of the notification (default: 25)                            |
| `onlyWhenPlaying`  | boolean        | Only play when the device is already playing music (default: false) |

### **Track Switches**

| Field              | Type                | Description                                         |
| ------------------ | ------------------- | --------------------------------------------------- |
| `name`             | string              | Name of the switch in HomeKit                       |
| `trackUri`         | string (URL)        | The music or stream URL to be played                |
| `sonosDeviceNames` | string[]            | Names of the Sonos devices that will play the track |
| `volume`           | number (1-100)      | Volume of the track (optional)                      |
| `seekPosition`     | string (`hh:mm:ss`) | Start time in the track (optional)                  |
| `stopAfter`        | number (seconds)    | Stops playback after X seconds (optional)           |

### **General Options**

| Field           | Type          | Description                                                                                                             |
| --------------- | ------------- |-------------------------------------------------------------------------------------------------------------------------|
| `sonosDeviceIp` | string (IPv4) | If automatic discovery fails, a fixed IP of any Sonos device can be specified as a starting point for device discovery. |

### **Track URIs**
Sonos understands a variety of Track URIs. Some examples: 
- `https://myserver.com/some_file.mp3`
- `spotify:track:3dPQuX8Gs42Y7b454ybpMR`
- `x-rincon-mp3radio://http://stream.srg-ssr.ch/drs3/mp3_128.m3u`

ℹ️ To easily figure out the track URIs of played tracks, this plugin logs the metadata (incl. track URI) of any song played on your Sonos system into the log.

## 🔗 Links

- [GitHub Repository](https://github.com/Glurz/homebridge-sonos-control)
- [Homebridge Plugin Page](https://www.npmjs.com/package/homebridge-sonos-control)

## 👋 Feedback & Support

If you have questions or issues, create an issue on [GitHub](https://github.com/Glurz/homebridge-sonos-control/issues). Enjoy your Sonos plugin! 🎶

## 🙏🏻 Credits

- This plugin uses [svroij](https://sonos-ts.svrooij.io/)'s library to access Sonos from TypeScript.

This plugin is not affiliated with Sonos.
