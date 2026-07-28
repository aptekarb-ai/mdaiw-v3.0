# MDAIW Module-1 HTML Asset Pack

This package contains reusable assets based on the approved Module-1 design.

## Package contents

- `60` scalable SVG interface icons
- PNG icon exports at 16, 20, 24, 32, 48, and 64 pixels
- SVG symbol sprite
- Yukti assistant illustration
- MDAIW AI hero illustration
- Neutral profile placeholder
- Face Recognition scan-frame overlay
- Success illustration
- Voice waveform illustration
- MDAIW favicon and wordmark
- CSS mask helper classes
- HTML preview page
- Feature-to-asset mapping in `manifest.json`

## Important logo note

The official MarketOne logo is not recreated here. Use the approved logo file
from the MarketOne brand library in production. `mdaiw-wordmark.svg` is a
project-level MDAIW placeholder, not the official MarketOne corporate logo.

## Folder structure

```text
MDAIW_Module1_HTML_Assets/
├── icons/
│   ├── svg/
│   ├── png/
│   │   ├── 16/
│   │   ├── 20/
│   │   ├── 24/
│   │   ├── 32/
│   │   ├── 48/
│   │   └── 64/
│   └── mdaiw-icons-sprite.svg
├── images/
│   ├── *.svg
│   └── png/
├── css/
│   └── mdaiw-icons.css
├── demo/
│   └── index.html
├── manifest.json
└── README.md
```

## Recommended React/Vite location

Copy the full folder into:

```text
frontend/public/assets/mdaiw/
```

Then reference an image:

```html
<img
  src="/assets/mdaiw/images/yukti-assistant.svg"
  alt="Yukti AI assistant"
/>
```

## Plain HTML image usage

```html
<img
  src="assets/mdaiw/images/mdaiw-ai-hero.svg"
  alt="MDAIW connected AI workspace"
/>
```

## PNG icon usage

```html
<img
  src="assets/mdaiw/icons/png/24/dashboard.png"
  width="24"
  height="24"
  alt=""
  aria-hidden="true"
/>
```

## CSS mask icon usage

Add:

```html
<link rel="stylesheet" href="assets/mdaiw/css/mdaiw-icons.css">
```

Then:

```html
<span
  class="mdaiw-icon mdaiw-icon--dashboard"
  aria-hidden="true"
></span>
```

Control its colour with normal CSS:

```css
.sidebar-link {
  color: #FFFFFF;
}

.sidebar-link.active {
  color: #76C043;
}
```

## SVG sprite usage

```html
<svg width="24" height="24" aria-hidden="true">
  <use href="assets/mdaiw/icons/mdaiw-icons-sprite.svg#icon-dashboard"></use>
</svg>
```

## Face Recognition overlay

Place the transparent overlay above the live video:

```html
<div class="camera-frame">
  <video id="face-video" autoplay muted playsinline></video>
  <img
    class="scan-overlay"
    src="assets/mdaiw/images/face-scan-frame.svg"
    alt=""
    aria-hidden="true"
  >
</div>
```

```css
.camera-frame {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
}

.camera-frame video,
.camera-frame .scan-overlay {
  width: 100%;
  height: 100%;
  display: block;
}

.camera-frame .scan-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
```

## Yukti voice button

```html
<button type="button" class="yukti-voice-button">
  <span class="mdaiw-icon mdaiw-icon--microphone" aria-hidden="true"></span>
  Talk to Yukti
</button>
```

## Feature mapping


### Public landing page

- `mdaiw-wordmark.svg`
- `mdaiw-ai-hero.svg`
- `login.svg`
- `registration.svg`
- `about.svg`
- `ai-assistants.svg`
- `microphone.svg`

### Password login

- `profile.svg`
- `lock.svg`
- `eye.svg`
- `eye-off.svg`
- `check.svg`
- `face-scan.svg`
- `microphone.svg`
- `arrow-right.svg`

### Face Recognition login

- `camera.svg`
- `face-scan.svg`
- `face-scan-frame.svg`
- `shield-check.svg`
- `spinner.svg`
- `check-circle.svg`
- `refresh.svg`
- `close.svg`

### Registration — account details

- `profile.svg`
- `email.svg`
- `lock.svg`
- `eye.svg`
- `check.svg`
- `arrow-right.svg`

### Registration — employee details

- `id-card.svg`
- `profile.svg`
- `briefcase.svg`
- `department.svg`
- `location.svg`
- `manager.svg`
- `calendar.svg`
- `phone.svg`
- `upload.svg`

### Registration — Face Enrollment

- `camera.svg`
- `face-scan.svg`
- `face-scan-frame.svg`
- `microphone.svg`
- `shield-check.svg`
- `check-circle.svg`

### Review and submit

- `file.svg`
- `edit.svg`
- `check-circle.svg`
- `arrow-left.svg`
- `arrow-right.svg`

### Success pages

- `success-celebration.svg`
- `check-circle.svg`
- `home.svg`
- `login.svg`

### Dashboard

- `dashboard.svg`
- `employees.svg`
- `performance.svg`
- `recognition.svg`
- `landing-page.svg`
- `email.svg`
- `finance.svg`
- `ai-assistants.svg`
- `reports.svg`
- `administration.svg`
- `settings.svg`
- `logout.svg`
- `search.svg`
- `bell.svg`
- `profile.svg`

### Yukti text and voice assistant

- `yukti-assistant.svg`
- `microphone.svg`
- `microphone-off.svg`
- `audio-wave.svg`
- `voice-wave.svg`
- `volume.svg`
- `volume-off.svg`
- `stop.svg`
- `send.svg`
- `close.svg`

### Profile and settings

- `profile-placeholder.svg`
- `profile.svg`
- `edit.svg`
- `upload.svg`
- `face-scan.svg`
- `refresh.svg`
- `delete.svg`
- `settings.svg`

## Accessibility

- Meaningful illustrations require useful `alt` text.
- Decorative icons should use `alt=""` or `aria-hidden="true"`.
- Buttons must retain visible text or an accessible label.
- Do not communicate status by colour alone.
- The camera overlay is decorative and should be hidden from screen readers.
