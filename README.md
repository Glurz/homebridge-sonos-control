# Homebridge Sonos Control Plugin
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

## ✨ Introduction

The **Homebridge Sonos Control Plugin** allows you to configure HomeKit switches to play (native) notifications or tracks on your Sonos devices.
If multiple tracks are configured for a switch, a track is selected at random.

## 🔧 Installation

Typically, you install the plugin via Homebridge's web UI.
For manual installation, use:

```sh
npm install -g homebridge-sonos-control
```

## 📄 Configuration

Configuration is done in `config.json` or via web UI.

### 📢 Example Configuration

```json
{
  "switches": [
    {
      "name": "Vecna Clock Bedroom",
      "sonosDeviceNames": [
        "Bedroom"
      ],
      "onlyWhenPlaying": false,
      "tracks": [
        {
          "trackUri": "http://192.168.0.3/stranger-things-clock2.mp3",
          "nativeNotification": true
        }
      ],
      "cronExpression": "0 * * * *"
    },
    {
      "name": "Radio Stream Livingroom",
      "sonosDeviceNames": [
        "Livingroom"
      ],
      "onlyWhenPlaying": false,
      "tracks": [
        {
          "trackUri": "x-rincon-mp3radio://http://stream.srg-ssr.ch/drs3/mp3_128.m3u",
          "nativeNotification": false,
          "volume": 30
        }
      ]
    },
    {
      "name": "Random Track Kitchen & Children",
      "sonosDeviceNames": [
        "Kitchen", "Children"
      ],
      "onlyWhenPlaying": false,
      "tracks": [
        {
          "trackUri": "spotify:track:1NVi9hztbG04tDrxvdv7Om",
          "nativeNotification": false,
          "stopAfter": 2000
        },
        {
          "trackUri": "spotify:track:3dPQuX8Gs42Y7b454ybpMR",
          "nativeNotification": false,
          "seekPosition": "00:03:27",
          "stopAfter": 3000
        }
      ]
    }
  ],
  "platform": "GlurzSonosControl"
}
```

## 📊 Configuration Options

### Switch
| Field              | Type            | Description                                                                                                                                                   |
|--------------------|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `name`             | string          | Name of the switch in HomeKit. (required)                                                                                                                     |
| `sonosDeviceNames` | string[]        | Names of the Sonos devices that will play the notification. (required)                                                                                        |
| `onlyWhenPlaying`  | boolean         | Only play this notification if the device is already playing. (default: false)                                                                                |
| `tracks`           | array of tracks | The definition of one or more tracks / notifications to be played by this switch. If more than one track is configured, one is selected at random. (required) |
| `cronExpression`   | string          | A cron expression to trigger this switch. See https://www.npmjs.com/package/cron?activeTab=readme (optional)                                                                                                     |


### Track
| Field                | Type                  | Description                                                                                                                                                   |
|----------------------|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `trackUri`           | string (URL)          | The URI of the track / notification to be played. Can be any URI Sonos understands. For native notifications, a MP3 or WAF file must be specified. (required) |
| `volume`             | number (1-100)        | Volume of the notification. Uses the devices volume if not specified. (optional)                                                                              |
| `nativeNotification` | boolean               | Whether the native Sonos notification should be used. See description below. (default: true)                                                                  |
| `seekPosition`     | string (`hh:mm:ss`)   | Start time in the track. Not available for native notifications. (optional)                                                                                   |
| `stopAfter`        | number (milliseconds) | Stops playback after given amount of milliseconds. Not available for native notifications. (optional)                                                                                                |

### General Options
| Field           | Type          | Description                                                                                                             |
| --------------- | ------------- |-------------------------------------------------------------------------------------------------------------------------|
| `sonosDeviceIp` | string (IPv4) | If automatic discovery fails, a fixed IP of any Sonos device can be specified as a starting point for device discovery. |

## Native vs. non-native notifications
Native notifications use a functionality of the Sonos speakers, in which a (short) notification is played, whereby the music currently playing is paused or, depending on the device model, continues to play quietly in the background. After the notification, the previous state is restored.
Native notifications are limited in that only MP3 or WAV URIs can be used.

Non-native notification emulate this behavior and also restore the state of the device before the notification. Non-native notifications support any kind of URI Sonos understands.

## Track URIs
Sonos understands a variety of Track URIs. Some examples: 
- `https://myserver.com/some_file.mp3`
- `spotify:track:3dPQuX8Gs42Y7b454ybpMR`
- `x-rincon-mp3radio://http://stream.srg-ssr.ch/drs3/mp3_128.m3u`

ℹ️ To easily figure out the track URIs of played tracks, this plugin logs the metadata (incl. track URI) of any song played on your Sonos system to the debug log.

## 🔗 Links

- [GitHub Repository](https://github.com/Glurz/homebridge-sonos-control)
- [Homebridge Plugin Page](https://www.npmjs.com/package/homebridge-sonos-control)

## 👋 Feedback & Support

If you have questions or issues, create an issue on [GitHub](https://github.com/Glurz/homebridge-sonos-control/issues). Enjoy your Sonos plugin! 🎶

## 🙏🏻 Credits

This plugin uses:
-  [svroij](https://sonos-ts.svrooij.io/)'s library to access Sonos from TypeScript.
- The [cron](https://www.npmjs.com/package/cron) library to trigger switches by cron expressions.

This plugin is not affiliated with Sonos.
