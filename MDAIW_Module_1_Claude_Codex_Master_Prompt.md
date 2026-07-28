# MDAIW Module-1 — Master Implementation Prompt for Claude Code / Codex

> **Project:** MarketOne Digital AI Workspace (MDAIW)  
> **Module:** Module-1 — Application Landing Page, Employee Registration, Password Login, Face Recognition Login, Dashboard Shell, Yukti Text and Voice Assistant  
> **Primary users:** Employees, administrators, and internal application users  
> **Target platforms:** Responsive web application for desktop, tablet, and mobile
> **Design source:** Detailed UI/UX specification and Module-1 PNG workflow references  

---

## How to use this prompt

Paste this complete prompt into Claude Code or Codex while the terminal is opened in the root folder of the MDAIW repository.

Do not provide only a plan. Inspect the repository, implement the module, run migrations and tests, fix errors, and provide a final implementation report.

---

# MASTER PROMPT

Act as a **Principal Full-Stack Software Architect, Senior React Developer, Senior Django/Python Developer, AI Engineer, Voice Interface Engineer, Computer Vision Engineer, UI/UX Designer, Security Engineer, Accessibility Specialist, and QA Lead**.

Build **Module-1 of the MarketOne Digital AI Workspace (MDAIW)** as a working, responsive web module.

The module must support:

1. Public application landing page.
2. Username and password login.
3. Mandatory Face Recognition login.
4. Employee registration with all defined employee details.
5. Live face enrollment during registration.
6. Dashboard navigation without a full-page refresh.
7. Yukti text assistant.
8. Yukti audio command and two-way voice communication.
9. Voice-guided normal login.
10. Voice-guided Face Recognition login.
11. Voice-assisted completion of registration fields.
12. Basic profile management.
13. Secure logout.

Keep the solution practical, simple to maintain, and suitable for an MVP. Do not remove any mandatory feature listed in this prompt.

---

# 1. EXECUTION RULES

Before modifying code:

1. Inspect the complete repository.
2. Identify the existing frontend, backend, database, routing, authentication, styling, testing, and environment setup.
3. Reuse existing architecture where practical.
4. Report relevant files and the proposed implementation order.
5. Identify blockers, but continue with all work that does not depend on external credentials.

Implementation rules:

1. Do not overwrite or delete working code without a clear reason.
2. Do not modify unrelated modules.
3. Do not stop after planning.
4. Implement the working module phase by phase.
5. Run migrations, linting, type checks, tests, and production builds where available.
6. Fix errors found during implementation.
7. Do not claim a feature works unless it has been implemented and verified.
8. Keep future application modules as functional navigation placeholders only.
9. Never hard-code secrets, passwords, biometric encryption keys, database credentials, API keys, or Django secret keys.
10. Create or update `.env.example`.
11. Never commit real `.env` values.
12. Provide Windows 10 PowerShell commands for installation and execution.
13. Report all files created and modified.
14. Keep the implementation modular and readable.
15. Avoid unnecessary enterprise complexity.
16. Password login must remain available as a fallback.
17. Face Recognition is mandatory and must not be replaced with a placeholder.
18. Yukti voice assistance is mandatory and must not be replaced with a static microphone icon.
19. Yukti must guide authentication but must never make or override authentication decisions.
20. The browser must not perform a full-page refresh after login or internal navigation.

---

# 2. PROJECT INFORMATION

## Project name

**MarketOne Digital AI Workspace**

## Short name

**MDAIW**

## Module name

**Module-1 — Application Landing Page, Employee Registration, Password Login, Face Recognition Login, Dashboard Shell, Yukti Text and Voice Assistant**

## Objective

Build a responsive application entry and navigation experience where an employee can:

1. View the MDAIW landing page.
2. Interact with Yukti using text or voice.
3. Register a new employee account.
4. Fill registration details manually or by speaking to Yukti.
5. Upload an employee profile photograph.
6. Give consent and enroll a live face for authentication.
7. Log in using username and password.
8. Ask Yukti to guide or initiate normal login.
9. Log in using username and live Face Recognition.
10. Ask Yukti to guide or initiate Face Recognition login.
11. Enter the dashboard without a full-page refresh.
12. Navigate among module placeholders.
13. View and update permitted profile information.
14. Re-enroll or remove Face Recognition credentials.
15. Log out securely.

---

# 3. REQUIRED TECHNOLOGY STACK

Use the existing stack if the repository already contains an equivalent solution. Otherwise use the following preferred stack.

## Frontend

- React
- TypeScript
- Vite
- React Router
- Functional components
- React Context or another lightweight state solution
- CSS Modules, SCSS, or a clean global CSS architecture
- Accessible modal and form components

## Primary backend

- Python
- Django
- Django REST Framework
- Django authentication and session framework
- PostgreSQL

## Face Recognition

- Python
- DeepFace
- `Facenet512` model
- RetinaFace detector where compatible
- Cosine distance comparison
- DeepFace anti-spoofing where supported

The Face Recognition implementation may use either:

### Option A — Dedicated FastAPI service

Use FastAPI only for Face Recognition and other AI/high-performance services.

### Option B — Django service layer

Keep Face Recognition inside a clearly separated Django service module.

Choose the simplest option that fits the existing repository. Keep Face Recognition code isolated from normal authentication and business logic.

## Yukti voice interface

Use browser-native voice capabilities for the MVP:

- Speech-to-text: Web Speech API using `SpeechRecognition` or `webkitSpeechRecognition` where available
- Text-to-speech: browser `speechSynthesis`
- Microphone capture only after explicit user action
- Push-to-talk interaction as the default MVP mode
- Typed fallback when speech recognition is unavailable

Do not require a paid speech API for Module-1 unless the repository already has one configured.

## Infrastructure exclusions for MVP

Do not introduce Redis, Celery, Kafka, Kubernetes, or complex microservices unless already required by the repository.

---

# 4. APPROVED BRANDING COLOUR PALETTE

Use the following colours consistently across all Module-1 screens.

| Element | Primary use | HEX |
|---|---|---|
| Primary Dark Teal | Header, sidebar, footer, strong headings | `#002D38` |
| Vibrant Blue/Cyan | Active navigation, highlighted links, secondary actions | `#0082AD` |
| Bright Accent Green | Primary CTA buttons and success actions | `#76C043` |
| Light Background Gray | Page backgrounds, alternating sections, containers | `#F4F6F8` |
| Pure White | Cards, form panels, text on dark backgrounds | `#FFFFFF` |
| Dark Charcoal Gray | Standard text on light backgrounds | `#333333` |

Create reusable CSS variables or design tokens:

```css
:root {
  --color-primary-dark: #002D38;
  --color-primary-blue: #0082AD;
  --color-accent-green: #76C043;
  --color-background-light: #F4F6F8;
  --color-white: #FFFFFF;
  --color-text-dark: #333333;
}
```

Do not use conflicting earlier colours such as `#111B31` or `#00A1D4` as principal colours.

---

# 5. TYPOGRAPHY HIERARCHY

Use a clean sans-serif font stack and the following approximate sizing:

- Main Hero Heading: 42px–48px
- Section Heading: 32px–36px
- Subheading: 22px–24px
- Card/Grid Heading: 18px–20px
- Body Text: 15px–16px
- Footer and Navigation Links: 13px–14px
- Top Bar Text: 12px–14px
- Button Text: approximately 14px, bold or semi-bold

Primary CTA buttons must use:

- Accent green background
- Dark teal text
- Clear hover, focus, active, disabled, and loading states
- Arrow or suitable icon where appropriate

---

<!-- DETAILED-UI-DESIGN-SPECIFICATION-START -->

# 5A. COMPLETE UI/UX DESIGN SPECIFICATION — SOURCE OF TRUTH

This section defines the expected visual design and interaction behaviour for every Module-1 screen. Claude Code / Codex must implement the frontend to match these specifications as closely as practical.

The textual requirements in this section are the **source of truth**. The PNG files are visual references. When a small text label in a generated PNG is unclear, use the exact copy written in this Markdown file.

## 5A.1 Design-reference assets

Place the approved reference images inside the repository under:

```text
docs/design-references/module-1/
```

Expected reference filenames:

```text
00_Module1_Full_Workflow_Overview.png
01_Public_Landing_Page.png
02_Password_Login_Page.png
03_Face_Recognition_Login_Camera.png
04_Face_Recognition_Verification_Progress.png
05_Registration_Account_Details.png
06_Registration_Employee_Details.png
07_Registration_Face_Enrollment.png
08_Face_Enrollment_Live_Capture.png
09_Face_Enrollment_Success.png
10_Registration_Review_and_Submit.png
11_Registration_Success.png
12_Dashboard_After_Login.png
```

Implementation rules for references:

1. Inspect all available PNG references before building components.
2. Do not copy unclear or malformed text from generated mockups; use the exact labels in this document.
3. Use the official MarketOne logo asset supplied by the project. Do not recreate, redraw, or substitute the logo with generated artwork.
4. Human faces shown in mockups are placeholders only. The production UI must show the real webcam preview or a neutral avatar.
5. The application must not depend on the PNG files at runtime.
6. Keep the visual language consistent across every page rather than styling each page independently.

---

## 5A.2 Base desktop artboard and application frame

Design the base web version first at a desktop viewport of approximately:

```text
1440px × 900px
```

The layout must remain usable from `1024px` upward and then adapt according to the responsive rules already defined in this prompt.

### Public application frame

```text
┌──────────────────────────┬──────────────────────────────────────────────┐
│ Public sidebar           │ Public content area                          │
│ 248px                    │ Remaining viewport width                     │
│ Dark teal                │ Light gray / white                           │
└──────────────────────────┴──────────────────────────────────────────────┘
```

Public-frame dimensions:

- Sidebar width: `248px`
- Content minimum width: `776px`
- Page minimum height: `100vh`
- Main content horizontal padding: `40px` desktop
- Main content vertical padding: `32px` desktop
- Public footer height: approximately `56px–64px`

### Authenticated application frame

```text
┌──────────────────────────┬──────────────────────────────────────────────┐
│ App sidebar              │ Header                                       │
│ 240px                    │ 68px                                         │
│                          ├──────────────────────────────────────────────┤
│                          │ Main content                                 │
│                          │                                              │
│                          ├──────────────────────────────────────────────┤
│                          │ Footer 56px                                  │
└──────────────────────────┴──────────────────────────────────────────────┘
```

Authenticated-frame dimensions:

- Sidebar width: `240px`
- Header height: `68px`
- Footer height: `56px`
- Main content padding: `24px–32px`
- Main content background: `#F4F6F8`
- Primary content cards: white with subtle borders and shadows

The header, sidebar, and footer must remain mounted while React Router changes only the main content panel.

---

## 5A.3 Extended design tokens

Use the approved colours and define the following derived tokens. Derived neutral colours may be used for borders, disabled states, and subtle text, but the six approved brand colours remain dominant.

```css
:root {
  --color-primary-dark: #002D38;
  --color-primary-blue: #0082AD;
  --color-accent-green: #76C043;
  --color-background-light: #F4F6F8;
  --color-white: #FFFFFF;
  --color-text-dark: #333333;

  --color-border: #D9E2E5;
  --color-border-strong: #B8C8CD;
  --color-text-muted: #66777D;
  --color-text-subtle: #829096;
  --color-success-bg: #EEF8E8;
  --color-info-bg: #EAF7FB;
  --color-error: #B42318;
  --color-error-bg: #FEF3F2;
  --color-warning: #B54708;
  --color-warning-bg: #FFFAEB;

  --shadow-card: 0 8px 24px rgba(0, 45, 56, 0.08);
  --shadow-modal: 0 20px 48px rgba(0, 45, 56, 0.20);

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-pill: 999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  --transition-fast: 120ms ease;
  --transition-standard: 180ms ease;
  --transition-panel: 240ms ease;
}
```

### Font stack

Prefer:

```css
font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
```

Do not block implementation if Inter is unavailable. Use the system fallback without shipping unapproved font files.

### Iconography

Use one consistent outline-icon library, preferably the project’s existing icon library or Lucide React.

Required icon categories:

- Home / Dashboard
- User / Employees
- Performance / chart
- Recognition / award
- Landing page / layout
- Email
- Finance / wallet
- AI assistant / bot
- Reports
- Administration / shield or settings
- Settings
- Logout
- Bell
- Search
- Microphone
- Camera
- Eye / eye-off
- Check / success
- Alert / error
- Arrow right
- Chevron

Icons must not be mixed between unrelated visual styles.

---

## 5A.4 Shared component measurements and states

### Buttons

Primary button:

- Height: `44px–48px`
- Horizontal padding: `20px–24px`
- Background: `#76C043`
- Text: `#002D38`
- Font weight: `600–700`
- Border radius: `8px`
- Optional arrow-right icon after the label

Primary hover:

- Slightly darker green derived from `#76C043`
- Do not change text colour
- Add a subtle upward or shadow effect, maximum `1px`

Secondary outline button:

- White background
- `1px` border using `#0082AD`
- Text and icon using `#0082AD`

Tertiary button:

- Transparent background
- Dark teal or blue text
- No shadow

Destructive action:

- White or error-tint background
- Error-colour border and label
- Use only for actions such as removing Face Recognition enrollment

Button states:

- Default
- Hover
- Keyboard focus with a visible focus ring
- Active
- Loading with spinner and disabled duplicate submission
- Disabled with reduced contrast but readable text

### Form fields

- Input height: `46px–48px`
- Label margin-bottom: `6px–8px`
- Input horizontal padding: `12px–14px`
- Border: `1px solid #D9E2E5`
- Border radius: `8px`
- Background: white
- Placeholder: muted gray
- Focus border: `#0082AD`
- Focus ring: subtle cyan tint
- Error border: `#B42318`
- Error message below input, `12px–13px`
- Required marker: red asterisk after label

Voice-filled field state:

- Cyan focus border
- Small temporary badge: `Filled by Yukti — please confirm`
- Show confirmation controls where required
- Do not auto-save or auto-submit

### Cards

- Background: `#FFFFFF`
- Border: `1px solid #D9E2E5`
- Border radius: `12px–14px`
- Padding: `20px–28px`
- Use `--shadow-card` only for elevated cards
- Avoid heavy shadows or glassmorphism

### Dividers

- `1px solid #D9E2E5`
- OR dividers place the label inside a small white gap

### Status badges

Success:

- Light green background
- Dark teal or dark green text
- Check icon

Processing:

- Light blue background
- Blue text
- Spinner or animated dots

Error:

- Light red background
- Error text
- Alert icon

### Modals and drawers

- Backdrop: `rgba(0, 45, 56, 0.55)`
- Modal background: white
- Modal radius: `14px–16px`
- Modal shadow: `--shadow-modal`
- Maximum desktop width based on function
- Focus trap is required
- Escape closes only when closing is safe

---

## 5A.5 Public sidebar design

The public sidebar appears on the landing, login, registration, Face Recognition, and registration-success views.

### Structure from top to bottom

1. Official MarketOne logo
2. Thin divider
3. Product title:
   - `MDAIW`
   - `Digital AI Workspace`
4. Main public navigation
5. Flexible spacer
6. Yukti assistant card
7. Copyright / footer microcopy

### Appearance

- Background: `#002D38`
- Text: white
- Full viewport height on desktop
- Logo region padding: `24px 20px`
- Navigation padding: `8px 12px`
- Navigation item height: `42px–44px`
- Navigation icon size: `18px–20px`
- Navigation label size: `14px`
- Active item: green-tinted or cyan-tinted background, white text, left accent indicator
- Hover item: translucent white or blue tint

### Public navigation items

```text
Login
Registration
About MDAIW
Ask Yukti
```

### Yukti compact assistant card

Place near the bottom of the sidebar.

Card content:

- Yukti bot/avatar icon
- Label: `Ask Yukti`
- Supporting text: `Your AI Assistant`
- Microphone icon/button
- Text such as `Click or speak to ask`

Card appearance:

- Darker or slightly lighter teal panel inside the sidebar
- Thin cyan border or top accent
- Rounded corners
- Microphone control must show listening state rather than being decorative

---

## 5A.6 Screen 01 — Public landing page

Reference:

```text
01_Public_Landing_Page.png
```

### Purpose

Introduce MDAIW and provide immediate paths to login, registration, and Yukti help.

### Layout

- Public sidebar on the left
- Hero content in the right panel
- Main hero content vertically centered
- Text block on the left side of the content area
- AI/workspace illustration or approved decorative graphic on the right
- Subtle blue wave pattern may appear near the lower edge

### Exact content hierarchy

Eyebrow:

> Welcome to

Main heading:

> MDAIW

Subheading:

> Digital AI Workspace

Body copy:

> A unified workspace to manage employees, performance, recognition, landing pages, email, personal finance, AI assistants, and more — all in one intelligent platform.

Actions:

```text
Login
Register
```

### Hero styling

- `MDAIW` heading uses dark teal, approximately `48px`
- `Digital AI Workspace` uses vibrant blue, approximately `24px–28px`
- Body copy maximum width: approximately `480px`
- Primary Login button uses accent green
- Register uses blue outline style
- Illustration must not overpower the content

### Behaviour

- Login CTA updates the right-side panel or route to `/login` without full-page refresh
- Register CTA opens `/register`
- Ask Yukti opens the Yukti panel
- Logo opens MarketOne website in a new tab

### Loading and error state

The public landing page should not depend on backend data. Do not display a full-page spinner.

---

## 5A.7 Screen 02 — Password login page

Reference:

```text
02_Password_Login_Page.png
```

### Layout

- Public sidebar remains unchanged
- Right content area uses light gray background
- Login card centered horizontally and vertically within the available area
- Card desktop width: approximately `500px–560px`
- Card padding: `32px–40px`

### Exact content

Eyebrow:

> Welcome back

Heading:

> Sign in to Digital AI Workspace

Supporting text:

> Use your username and password to log in.

Fields:

```text
Username
Password
Remember my username
```

Actions:

```text
Sign In →
Sign in with Face Recognition
Ask Yukti to help me sign in
New employee? Register
```

### Field arrangement

- One column
- Password field contains eye / eye-off control inside the right end
- Remember checkbox aligns left
- Sign In is full width
- OR divider separates password login from Face Recognition
- Face Recognition is a full-width secondary outline button
- Yukti assistance is a tertiary text/voice action below or near Face Recognition

### States

Default:

- Empty inputs
- Sign In enabled only according to the project’s validation pattern

Typing:

- Field focus uses cyan border

Validation:

- Show field error directly below the relevant input
- Keep card height stable where practical

Submitting:

- Button label: `Signing in...`
- Spinner inside button
- Prevent duplicate submit

Invalid credentials:

- Form-level alert near the top of the form
- Exact message: `Invalid username or password.`

Success:

- Briefly show authenticated state only if needed
- Navigate to dashboard immediately without page refresh

### Voice-assistance visual behaviour

When Yukti is guiding login:

- Open a right-side assistant drawer or compact floating panel
- Highlight the current field with cyan border
- Show the visible transcript
- Do not accept password dictation
- Show: `Please type your password securely.`

---

## 5A.8 Screen 03 — Face Recognition login camera

Reference:

```text
03_Face_Recognition_Login_Camera.png
```

### Layout

- Public sidebar remains visible
- Main card desktop width: approximately `620px–720px`
- Username field appears above the camera preview
- Camera preview uses a `16:9` or similarly wide ratio
- Camera corners show four green framing brackets
- Instruction text appears directly beneath the preview
- Action row appears at the bottom

### Exact content

Eyebrow:

> Welcome back

Heading:

> Sign in with Face Recognition

Supporting text:

> Enter your username and verify with your face.

Field:

```text
Username
```

Camera guidance:

> Position your face inside the frame.

Secondary guidance:

> Make sure your face is clearly visible.

Actions:

```text
Cancel
Verify My Face →
```

### Camera preview states

Before permission:

- Camera placeholder with camera icon
- Button: `Open Camera`

Requesting permission:

- Spinner
- Text: `Requesting camera access...`

Permission denied:

- Warning card
- Explain browser permission requirement
- Buttons: `Try Again` and `Use Password Login`

Camera ready:

- Show live feed
- Green face frame
- Verify button enabled only when frames can be captured

Capturing:

- Show progress such as `Capturing 1 of 3`
- Disable close only during a very short atomic capture operation; otherwise allow cancellation

No face / multiple faces:

- Show guidance overlay and accessible text message
- Do not show technical model output

### Yukti voice guidance

Yukti may speak:

- `Please position your face inside the frame.`
- `Move slightly closer.`
- `Make sure only one person is visible.`
- `Look directly at the camera.`

The visual transcript must show the same guidance.

---

## 5A.9 Screen 04 — Face Recognition verification progress

Reference:

```text
04_Face_Recognition_Verification_Progress.png
```

### Purpose

Show transparent progress after live frames are captured and before the backend returns the final authentication result.

### Layout

- Centered verification card
- Circular progress or face thumbnail inside a branded circular ring
- Vertical checklist on desktop
- Calm, minimal appearance
- No fake success animation before backend confirmation

### Exact heading

> Verifying your identity

Supporting text:

> Please hold still...

### Required progress steps

```text
Camera access granted
Face detected
Liveness check
Verifying identity
Creating secure session
```

Step states:

- Complete: green check
- Active: cyan spinner / progress indicator
- Pending: muted gray circle
- Failed: error icon and safe explanation

### Footer guidance

> Do not close this window or move away from the camera.

### Success behaviour

Only after the backend confirms liveness, face match, active account, and Django session creation:

- Show `Face verified successfully.`
- Transition to dashboard

### Failure behaviour

Show a generic failure card with:

```text
Try Again
Use Password Login
```

Do not expose distance scores or thresholds.

---

## 5A.10 Registration wizard — shared layout

Registration uses four visible steps:

```text
1. Account Details
2. Employee Details
3. Face Enrollment
4. Review and Submit
```

### Shared registration shell

- Public sidebar remains visible
- Registration navigation item is active
- Main content uses a centered card or panel with maximum width `1040px–1120px`
- Stepper appears above the content card
- Main card uses white background
- Bottom action row remains visually consistent

### Stepper design

Each step has:

- Numbered circle
- Label below or beside circle
- Connector line between circles

States:

- Upcoming: gray circle and label
- Active: accent green circle, dark label
- Completed: green circle with check icon
- Error: error-colour indicator

The stepper is not used as an uncontrolled shortcut. Users may navigate to completed steps, but cannot skip required incomplete steps.

### Shared action row

- Back button on the left or right-side group
- Next / Continue as primary green button
- Save nothing automatically unless supported by the application
- Show page-level validation summary above action row when necessary

### Yukti during registration

- Yukti compact card remains available in sidebar
- Full assistant opens as a drawer or panel
- Current field receives a blue highlight
- Transcript remains visible
- A voice-filled field displays a confirmation state
- Yukti can move between fields and steps only within validation rules

---

## 5A.11 Screen 05 — Registration Step 1: Account Details

Reference:

```text
05_Registration_Account_Details.png
```

### Heading

> Create your account

Supporting text:

> Fill in your account details.

### Desktop layout

Use a two-column content arrangement:

- Left/main form column: username, work email, password, confirm password
- Right supporting column: live password-requirements panel

Suggested widths:

- Form: `60%–65%`
- Requirements: `35%–40%`

### Fields

```text
Username
Work Email
Password
Confirm Password
```

### Password-requirements panel

Title:

> Password must contain:

Items:

```text
At least 8 characters
One uppercase letter
One lowercase letter
One number
```

Each item changes from muted to green check as the requirement is met.

### Actions

```text
Next →
```

### Behaviour

- Validate username format while typing after a sensible delay
- Do not send excessive availability requests
- Confirm spoken work email visually
- Password fields are never voice-filled
- Next validates the complete step before moving on

---

## 5A.12 Screen 06 — Registration Step 2: Employee Details

Reference:

```text
06_Registration_Employee_Details.png
```

### Heading

> Employee Information

Supporting text:

> Please provide your employment details.

### Desktop field grid

Use a responsive three-column grid at wide desktop sizes and a two-column grid at narrower desktop sizes.

Row suggestion:

```text
Employee ID | First Name | Last Name
Designation | Department | Location
Reporting Manager | Date of Joining | Phone Number
Date of Birth | Profile Photo | optional empty/grid space
```

### Profile photo uploader

Display a compact circular or rounded-square uploader near the top-right of the card or as a grid field.

States:

- Empty placeholder with user icon
- Hover: `Upload photo`
- Preview after selection
- Replace and Remove actions
- Optional badge

### Dropdowns

Department, Location, and Reporting Manager may use searchable selects if the project already has data. Otherwise use accessible standard selects or text fields according to the existing architecture.

### Voice-entry state

For critical values such as Employee ID, joining date, phone number, and DOB:

- Display the recognized value
- Add a small confirmation row
- Buttons or commands: `Confirm` / `Change`
- Do not move to the next field until confirmation where required

### Actions

```text
← Back
Next →
```

---

## 5A.13 Screen 07 — Registration Step 3: Face Enrollment introduction

Reference:

```text
07_Registration_Face_Enrollment.png
```

### Heading

> Face Recognition Enrollment

Supporting text:

> Use your camera to enroll your face for secure login.

### Desktop layout

Two-column card:

- Left: instructions and consent
- Right: camera placeholder or preview

Suggested widths:

- Instructions: `40%`
- Camera: `60%`

### Instruction list

Use numbered or icon-led rows:

```text
Look directly at the camera
Ensure good lighting
Remove sunglasses or face coverings
Only one person should be visible
```

### Consent

Place the consent checkbox below the instruction list and above actions:

> I consent to the processing of my facial data for authentication.

Consent must be visually clear and not preselected.

### Camera area

Before opening:

- Neutral camera placeholder
- Face-outline frame
- Camera icon
- Supporting text

Actions:

```text
← Back
Open Camera
```

Open Camera remains disabled until consent is confirmed.

---

## 5A.14 Screen 08 — Face Enrollment live capture

Reference:

```text
08_Face_Enrollment_Live_Capture.png
```

### Layout

- Large camera preview on the left, approximately `65%`
- Capture-step panel on the right, approximately `35%`
- Bottom progress bar under the preview
- Cancel action at the lower edge

### Capture steps

```text
1. Look Straight
2. Turn Slightly Left
3. Turn Slightly Right
```

Step states:

- Complete: green check
- Current: green or cyan active circle
- Upcoming: muted gray

### Camera overlay

- Four green corner brackets
- Optional oval face guide
- Do not cover the face with excessive graphics
- Show current instruction above or below the preview

### Progress text

Examples:

```text
Capturing... Step 1 of 3
Capturing... Step 2 of 3
Capturing... Step 3 of 3
Checking liveness...
Creating encrypted face credential...
```

### Controls

```text
Cancel
Retake
Use These Captures
```

Only show controls appropriate to the current state.

### Error states

Errors appear in a clear alert near the camera area:

- No face detected
- Multiple faces detected
- Poor lighting
- Liveness failed
- Camera interrupted

The user can retry without losing previously entered registration fields.

---

## 5A.15 Screen 09 — Face Enrollment success state

Reference:

```text
09_Face_Enrollment_Success.png
```

### Layout

- Centered success card inside the registration shell
- Large green check icon
- Minimal copy
- One strong primary CTA

### Exact content

Heading:

> Face enrolled successfully!

Body:

> Your face has been captured and secured. You can now use Face Recognition to sign in.

Action:

> Continue to Review →

This success state belongs to Step 3 and then advances to Step 4.

Do not imply that a normal account has already been created before final registration submission.

---

## 5A.16 Screen 10 — Registration Step 4: Review and Submit

Reference:

```text
10_Registration_Review_and_Submit.png
```

### Heading

> Review & Confirm

Supporting text:

> Please review your information before creating your account.

### Summary sections

Use separate bordered summary groups:

1. Account Details
2. Employee Details
3. Profile Photo
4. Face Recognition

Never display password or password confirmation values.

### Example summary structure

```text
Account Details
Username                 Work Email

Employee Details
Employee ID              Name
Designation              Department
Location                 Reporting Manager
Joining Date             Phone
Date of Birth            Profile Photo status

Face Recognition
Status: Enrolled Successfully
Consent: Confirmed
```

Each section may include an `Edit` action that returns to the corresponding completed step.

### Confirmation checkbox

> I confirm that the entered information is correct.

### Actions

```text
← Back
Create Account →
```

The primary action remains disabled until the confirmation checkbox is selected and all backend-ready validation passes.

### Submission state

- Button text: `Creating account...`
- Show spinner
- Prevent duplicate submission
- Keep the user on the page if validation fails
- Highlight the section and field requiring correction

---

## 5A.17 Screen 11 — Registration success

Reference:

```text
11_Registration_Success.png
```

### Layout

- Public sidebar remains visible
- Main content contains a centered success card
- Card width: approximately `520px–600px`
- Large green check icon with subtle celebration accents allowed

### Exact content

Heading:

> Registration Successful!

Body:

> Your account has been created successfully. You can now sign in using your username and password or Face Recognition.

Primary action:

> Go to Sign In →

Secondary action:

> Back to Home

### Behaviour

- Go to Sign In opens `/login`
- Preserve remembered username only when the user opted into it
- Do not auto-login unless explicitly enabled elsewhere

---

## 5A.18 Screen 12 — Dashboard after login

Reference:

```text
12_Dashboard_After_Login.png
```

### Authenticated sidebar

Top:

- Official MarketOne logo
- Optional collapsed-menu button on narrow screens

Navigation:

```text
Dashboard
Employees
Performance
Recognition
Landing Pages Builder
Email Builder
Personal Finance
AI Assistants
Reports
Administration
Settings
Logout
```

Active item:

- Blue/cyan or green-tinted background
- White text
- Clear active indicator

Bottom:

- Yukti compact assistant card
- Optional version/copyright text

### Header

Left/center:

- Search / Ask Yukti input
- Placeholder: `Search or ask Yukti...`
- Microphone button attached to or next to the input

Right:

- Notification bell
- Profile photo or initials
- User name
- Designation or role
- Dropdown chevron

### Main dashboard content

Top welcome row:

- Heading: `Welcome back, {First Name}!`
- Friendly supporting message
- Compact identity summary on the right or below

Identity fields:

```text
Employee ID
Designation
Department
Location
```

### Dashboard cards

Keep the dashboard simple. No heavy charts.

Use up to four small summary cards when data exists, for example:

```text
Total Employees
Active Projects
Tasks Completed
Recognition Points
```

If real data does not exist in Module-1, use clearly labelled demo placeholders or omit the metric row rather than hard-coding misleading production values.

### Quick-access cards

Required:

```text
My Profile
Employees
Ask Yukti
Reports
```

Each card includes:

- Simple icon
- Short title
- One-line description
- Text action such as `View →` or `Ask →`

### Lower dashboard area

Optional simple sections:

- Recent activity list
- Yukti suggestion card

Do not add complex graphs, financial charts, or performance charts in Module-1.

### Navigation behaviour

- Clicking sidebar links updates only the main content
- Preserve the application shell
- Show route loading skeleton only in content area
- Voice navigation through Yukti follows the same routes and permission checks

---

## 5A.19 Yukti full assistant — text and voice design

Yukti is available before and after login. Use a consistent assistant experience rather than separate unrelated widgets.

### Desktop presentation

Preferred pattern:

- Right-side drawer, width approximately `380px–420px`
- May overlay the current page with a backdrop on small screens
- On large desktop, it may push or overlay content according to available space

### Header

- Yukti avatar or bot icon
- Name: `Yukti`
- Subtitle: `Your AI Assistant`
- Voice status badge, for example `Listening...`
- Mute / stop-speaking control
- Close button

### Conversation area

- Yukti messages align left with light gray or blue-tinted bubble
- User messages align right with green-tinted bubble
- Timestamp is optional and small
- Keep transcript text selectable
- Auto-scroll only when the user is already near the bottom

### Composer

- Text input placeholder: `Type your message...`
- Send icon button
- Large microphone / push-to-talk button
- Microphone button states:
  - Idle
  - Requesting permission
  - Listening
  - Processing
  - Error
  - Disabled / unsupported

### Listening visual

When listening:

- Microphone uses blue/cyan ring animation
- Text: `Listening...`
- Show live or final transcript
- Provide a clear Stop button
- Do not create aggressive full-screen animations

### Voice guidance during forms

When Yukti updates a field:

1. Focus and highlight the field.
2. Insert the recognized value.
3. Display a small confirmation strip.
4. Speak a concise confirmation.
5. Wait for user confirmation where required.

Example confirmation strip:

```text
Yukti entered: M1-1001
[Confirm] [Change]
```

### Password security state

If the user attempts to dictate a password:

- Do not place the transcript into the password field
- Do not save it in conversation history
- Respond visually and audibly:

> For your security, please type your password manually.

### Yukti error states

- Microphone permission denied
- Voice input unsupported
- Speech not understood
- Network unavailable for backend help
- Command requires authentication
- Command requires confirmation

Each error includes a safe recovery action.

---

## 5A.20 Profile page design

Route:

```text
/profile
```

### Layout

Use authenticated shell.

Top profile card:

- Profile photo or initials
- Full name
- Username
- Designation
- Department
- `Edit Profile` action

Main content uses two columns on desktop:

- Left/main: personal and employment details
- Right: account and Face Recognition security

### Information sections

```text
Personal Information
Employment Information
Account Information
Face Recognition Security
```

### Editable fields

Display permitted fields in standard form controls. Protected values appear as read-only rows with a lock icon or `Managed by administrator` helper text.

### Face Recognition security card

Show:

- Enrollment status badge
- Enrollment date
- Last successful verification date if available
- `Re-enroll Face`
- `Remove Face Enrollment`

Removal uses a confirmation modal and a destructive action style.

### Actions

```text
Cancel
Save Changes →
```

Show save success with an inline toast or alert. Do not reload the full page.

---

## 5A.21 Settings page design

Route:

```text
/settings
```

Use grouped cards rather than one long unstructured form.

Required Module-1 settings groups:

### Login preferences

- Remember username toggle
- Preferred login method where appropriate

### Yukti voice preferences

- Enable voice assistance
- Spoken response on/off
- Speech language selector, default `English (India)` when configured
- Speech rate control only if simple to implement
- Test voice button

### Face Recognition

- Enrollment status
- Re-enroll
- Remove enrollment

### Accessibility

- Reduce motion toggle
- High-contrast preference only if the project supports it

Changes must save without full-page refresh and show a visible success message.

---

## 5A.22 Module-placeholder page design

Routes such as Employees, Performance, Recognition, Landing Pages Builder, Email Builder, Personal Finance, AI Assistants, Reports, and Administration may use a common placeholder component in Module-1.

### Layout

- Authenticated shell remains visible
- Centered white card in the main content area
- Module icon
- Module title
- Short description
- Status badge: `Planned` or `Coming in a future phase`
- Actions:
  - `Back to Dashboard`
  - `Ask Yukti about this module`

Exact generic message:

> Module functionality will be implemented in a future phase.

Do not leave a blank content area.

---

## 5A.23 Logout confirmation design

Logout may be triggered from:

- Header profile menu
- Sidebar
- Yukti voice command

For direct click, the project may log out immediately or show a confirmation according to the existing pattern. For voice-triggered logout, confirmation is mandatory.

Suggested modal:

Heading:

> Log out of MDAIW?

Body:

> You will need to sign in again to access your workspace.

Actions:

```text
Cancel
Log Out
```

On success:

- Stop camera
- Stop microphone
- Stop speech synthesis
- Clear auth state
- Navigate to `/login`

---

## 5A.24 Header profile menu design

Open from profile photo/name.

Menu items:

```text
My Profile
Settings
Face Recognition Status
Help
Logout
```

Menu requirements:

- Align to the right edge of the trigger
- White card with subtle shadow
- Keyboard accessible
- Escape closes
- Clicking outside closes
- Logout separated by divider

---

## 5A.25 Notifications placeholder design

The bell icon is present in Module-1 but full notification functionality is not required.

On click, show a compact popover:

Heading:

> Notifications

Empty state:

> You have no new notifications.

Do not create fake production notifications unless labelled as demonstration data.

---

## 5A.26 Form-validation visual rules

### Field error

- Red border
- Error icon optional
- Message below field
- `aria-invalid="true"`
- Associate message through `aria-describedby`

### Form-level validation summary

For multi-field errors, show a summary at the top of the card:

Heading:

> Please correct the highlighted fields.

The summary may link/focus the relevant fields.

### Success

- Green inline banner or toast
- Do not use browser `alert()`

### Network/server failure

- Preserve all non-sensitive entered data
- Show retry action
- Never preserve raw password after a failed full registration request unless the current safe form state naturally retains it in memory

---

## 5A.27 Loading, skeleton, empty, and error states

Every major page must define these states where applicable:

### Loading

- Content-area skeletons rather than full-page blank spinner
- Button-level spinners for submissions
- Camera and voice use dedicated status text

### Empty

- Friendly icon
- One sentence explaining the state
- Clear next action

### Error

- Human-readable message
- Recovery action
- No raw traceback or provider exception

### Offline/network interruption

- Show: `We could not connect. Check your connection and try again.`
- Registration data should not be silently discarded

---

## 5A.28 Motion and transitions

Use subtle motion only:

- Button hover: `120ms`
- Input focus: `120ms`
- Drawer open/close: `240ms`
- Route content fade/slide: maximum `180ms`
- Success check animation: optional, maximum `500ms`

Respect `prefers-reduced-motion`.

Do not use parallax, excessive bouncing, or long animated loading screens.

---

## 5A.29 Responsive visual behaviour by feature

### Public landing/login

Tablet:

- Sidebar may reduce to approximately `210px`
- Card width adapts to remaining space

Mobile:

- Sidebar becomes top header plus navigation drawer
- Hero illustration may move below text or be hidden
- Login card becomes full-width with `16px` page margins

### Registration wizard

Tablet:

- Step labels may shorten but must remain understandable
- Field grid becomes two columns

Mobile:

- Stepper may become a compact progress header such as `Step 2 of 4`
- All fields become one column
- Bottom actions may become sticky if they do not cover content

### Camera views

Tablet/mobile:

- Camera preview uses available width
- Instruction panel moves below preview
- Modal occupies most of the viewport
- Cancel remains reachable

### Dashboard

Tablet:

- Sidebar collapses to icon rail or drawer
- Header search remains available

Mobile:

- Sidebar is a drawer
- Header search may become an icon opening a search sheet
- Summary and quick-access cards become one column
- Profile label may collapse to avatar

### Yukti drawer

Mobile:

- Becomes a full-height bottom sheet or full-screen panel
- Microphone and close controls remain fixed and reachable
- Must not obscure active registration fields without a way to close/minimize

---

## 5A.30 Component-to-screen implementation map

Create reusable components with responsibilities similar to the following:

```text
layouts/
  PublicLayout
  AppLayout

navigation/
  PublicSidebar
  AppSidebar
  AppHeader
  ProfileMenu
  MobileNavigationDrawer
  Footer

forms/
  FormField
  PasswordField
  CheckboxField
  SelectField
  DateField
  PhotoUploader
  VoiceFieldConfirmation
  ValidationSummary

buttons/
  PrimaryButton
  SecondaryButton
  IconButton
  LoadingButton

registration/
  RegistrationWizard
  RegistrationStepper
  AccountDetailsStep
  EmployeeDetailsStep
  FaceEnrollmentStep
  FaceCaptureView
  ReviewSubmitStep
  RegistrationSuccess

face-recognition/
  CameraPreview
  CameraPermissionState
  FaceFrameOverlay
  FaceCaptureProgress
  FaceVerificationProgress
  FaceErrorState
  FaceEnrollmentStatus

assistant/
  YuktiCompactCard
  YuktiDrawer
  YuktiMessageList
  YuktiComposer
  YuktiMicrophoneButton
  YuktiVoiceStatus
  VoiceTranscript
  VoiceConfirmationPrompt

feedback/
  Alert
  Toast
  StatusBadge
  EmptyState
  LoadingSkeleton
  ConfirmDialog

pages/
  LandingPage
  LoginPage
  FaceLoginPage
  RegisterPage
  RegistrationSuccessPage
  DashboardPage
  ProfilePage
  SettingsPage
  ModulePlaceholderPage
```

Use the existing project naming conventions when they differ, but preserve the same separation of responsibilities.

---

## 5A.31 Visual acceptance checks for Claude Code / Codex

Before declaring the frontend complete, compare the running application with every reference screen and verify:

1. Official palette is used consistently.
2. Public sidebar and authenticated sidebar are visually distinct but related.
3. Sidebar width, header height, footer height, and main spacing are consistent.
4. All required pages have meaningful content; no blank placeholders.
5. Password login visually separates Face Recognition using an OR divider.
6. Camera screen clearly shows face framing and current instructions.
7. Verification progress does not report success early.
8. Registration uses the four-step wizard.
9. Completed, active, and upcoming step states are visually different.
10. Employee fields are arranged in a responsive grid.
11. Profile-photo uploader has empty, preview, replace, and remove states.
12. Face consent is visible and unselected by default.
13. Live capture shows the three required poses and progress.
14. Review page hides passwords.
15. Success pages clearly indicate the next action.
16. Dashboard follows the attached shell and remains simple.
17. Yukti has real text, microphone, transcript, listening, and error states.
18. Voice-filled values are visually highlighted and confirmable.
19. Profile and settings use the same design system.
20. Focus, validation, loading, empty, and error states are implemented.
21. Desktop layout has no unintended overflow at `1440px`, `1280px`, or `1024px`.
22. Tablet and mobile do not have horizontal scrolling.
23. Browser zoom at `200%` remains usable where practical.
24. Keyboard focus order follows the visual order.
25. No generated mockup image is used as a full-page background to fake the UI.

<!-- DETAILED-UI-DESIGN-SPECIFICATION-END -->

---

# 6. RESPONSIVE DESIGN REQUIREMENTS

## Desktop — 1024px and above

- Persistent left navigation panel
- Header visible
- Main panel uses remaining width
- Registration can use a two-column grid
- Sidebar width approximately 240px–260px
- Header height approximately 64px–72px
- Footer height approximately 64px–80px

## Tablet — 768px to 1023px

- Collapsible sidebar
- Menu button opens full navigation
- Registration may use one or two columns depending on width
- Yukti panel must remain usable

## Mobile — below 768px

- Sidebar becomes a drawer
- Forms become single-column
- Buttons are at least approximately 44px high
- No horizontal scrolling
- Header contains menu, Yukti, and profile controls
- Footer links wrap correctly
- Camera modal fills most of the viewport safely
- Voice-assistant control remains reachable without covering form fields

---

# 7. MAIN APPLICATION STATES

## State A — Before login

Display:

- MarketOne logo
- Login navigation
- Registration navigation
- About MDAIW navigation
- Ask Yukti navigation
- Right-side dynamic content panel
- Text and voice Yukti controls
- Footer

Do not expose private employee data or protected modules.

## State B — After login

Display:

- MarketOne logo
- Left module navigation
- Top header
- Search or Ask Yukti input
- Microphone control for Yukti
- Notification icon placeholder
- User-profile control
- Logout control
- Selected-module content panel
- Footer

After login, the sidebar contains:

- Dashboard
- Employees
- Performance
- Recognition
- Landing Pages Builder
- Email Builder
- Personal Finance
- AI Assistants
- Reports
- Administration
- Settings
- Logout

Only Dashboard, Profile, Settings, Logout, authentication, registration, Face Recognition, and Yukti assistance need real Module-1 functionality.

All other modules should show a reusable placeholder:

> Module functionality will be implemented in a future phase.

---

# 8. CLIENT-SIDE ROUTING

Use React Router.

Required routes:

```text
/
/login
/register
/dashboard
/profile
/employees
/performance
/recognition
/landing-pages
/email-builder
/personal-finance
/ai-assistants
/reports
/administration
/settings
```

Routing requirements:

1. No full-page refresh for internal navigation.
2. Successful login navigates to `/dashboard`.
3. Application shell remains mounted while main content changes.
4. Protected routes redirect unauthenticated users to `/login`.
5. Authenticated users visiting `/login` or `/register` redirect to `/dashboard`.
6. Yukti voice commands may navigate to permitted routes after authentication.

---

# 9. PUBLIC LANDING PAGE

Desktop structure:

```text
┌────────────────────┬──────────────────────────────────────────┐
│ MarketOne Logo     │                                          │
│                    │                                          │
│ Login              │       Selected Public Content            │
│ Registration       │                                          │
│ About MDAIW        │       Login / Registration / About       │
│ Ask Yukti          │                                          │
│                    │       Yukti text + microphone control     │
└────────────────────┴──────────────────────────────────────────┘
```

Use:

- Dark teal left control panel
- Light gray main page background
- White form and card panels
- Green CTA buttons
- Blue active navigation indicators

The MarketOne logo must open:

```text
https://www.marketone.com/
```

Use:

```html
<a
  href="https://www.marketone.com/"
  target="_blank"
  rel="noopener noreferrer"
>
  MarketOne Logo
</a>
```

Create reusable components such as:

- `PublicSidebar`
- `AuthLayout`
- `LoginPanel`
- `RegistrationWizard`
- `AboutPanel`
- `YuktiAssistant`
- `YuktiVoiceControl`
- `Footer`
- `FormField`
- `PasswordField`
- `LoadingButton`
- `AccessibleModal`
- `CameraModal`
- `VoiceTranscriptPanel`

---

# 10. PASSWORD LOGIN

## Login panel content

Eyebrow:

> Welcome back

Heading:

> Sign in to Digital AI Workspace

Supporting text:

> Use your username and password to log in.

Fields and actions:

1. Username
2. Password
3. Show/hide password
4. Remember my username
5. Sign In button
6. Sign in with Face Recognition button
7. Ask Yukti by voice button
8. Registration link

Suggested UI:

```text
Username
[________________________________]

Password
[_____________________________ eye-icon]

[ ] Remember my username

[             Sign In →             ]

──────────────── OR ────────────────

[ Face icon  Sign in with Face Recognition ]

[ Microphone icon  Ask Yukti to help me sign in ]

New employee? Register
```

## Password-login behaviour

1. Validate required fields.
2. Submit credentials to Django.
3. Django validates credentials.
4. Django creates the authenticated session.
5. React updates the authentication state.
6. Navigate to `/dashboard` without reloading.

## Validation messages

- Empty username: `Username is required.`
- Empty password: `Password is required.`
- Invalid credentials: `Invalid username or password.`

Do not reveal whether the username exists.

## Remember username

The checkbox may store only the username. Never store the password.

---

# 11. YUKTI AUDIO AND VOICE ASSISTANCE

Yukti must support both text and voice communication.

## Interaction modes

1. Typed text chat
2. Push-to-talk speech input
3. Spoken response through text-to-speech
4. Visual transcript of user speech and Yukti response
5. Typed fallback if voice is unsupported

## Default voice interaction model

Use **push-to-talk**, not continuous always-on listening.

Flow:

```text
User clicks microphone
        ↓
Browser requests microphone permission
        ↓
User speaks
        ↓
Speech is transcribed
        ↓
Yukti detects intent
        ↓
Yukti updates the UI or provides instructions
        ↓
Yukti speaks the response
        ↓
Transcript remains visible
```

## Required microphone states

- Voice unavailable
- Permission not requested
- Requesting permission
- Listening
- Processing speech
- Command understood
- Command needs confirmation
- Command not understood
- Permission denied
- Microphone unavailable
- Stopped

## Example UI labels

- `Talk to Yukti`
- `Listening...`
- `Processing your request...`
- `I heard: “Open Face Recognition login.”`
- `Please confirm before I continue.`
- `I could not understand that. Please try again or type your request.`

## Voice privacy rules

1. Start listening only after a clear user action.
2. Show a visible listening indicator.
3. Stop listening when the user stops, cancels, navigates away, or the modal closes.
4. Do not keep the microphone continuously active.
5. Do not save raw audio in the MVP.
6. Do not log raw speech audio.
7. Store transcripts only if explicitly required and documented.
8. Provide a clear way to mute spoken responses.
9. Provide a clear way to stop speech synthesis.
10. Never speak passwords, biometric data, secret keys, or security tokens.

## Browser support handling

Detect whether speech recognition is supported.

If unsupported, show:

> Voice input is not supported in this browser. You can continue using typed commands.

Text-to-speech may still be used when available.

---

# 12. YUKTI VOICE-GUIDED NORMAL LOGIN

Yukti may help with normal login, but authentication remains deterministic.

## Supported voice commands before login

Examples:

- `Yukti, open login.`
- `Yukti, help me sign in.`
- `My username is brahmesh.aptekar.`
- `Show the password field.`
- `Hide the password.`
- `Remember my username.`
- `Do not remember my username.`
- `Submit login.`
- `Open registration.`
- `Use Face Recognition instead.`

## Security rules for voice login

1. Yukti may fill or focus the username field.
2. Yukti may toggle show/hide password only when requested.
3. The password must be typed by the user.
4. Do not accept or store the password through speech recognition.
5. Yukti must never repeat the password aloud.
6. Yukti may submit the form only after the user has typed a password and confirms submission.
7. Login success is decided only by Django authentication.
8. Yukti must not create a session directly.

## Example voice flow

```text
User: “Yukti, help me log in.”
Yukti: “I have opened the login form. Please tell me your username.”

User: “My username is brahmesh.aptekar.”
Yukti: “I entered the username. Please type your password securely.”

User types password.

User: “Submit login.”
Yukti: “Would you like me to submit the login form?”

User: “Yes.”
Yukti submits the form.
Django authenticates the user.
```

---

# 13. YUKTI VOICE-GUIDED FACE RECOGNITION LOGIN

Yukti must help initiate and guide Face Recognition login.

## Supported commands

- `Yukti, sign me in with my face.`
- `Open Face Recognition.`
- `My username is brahmesh.aptekar.`
- `Open the camera.`
- `Start face verification.`
- `Cancel face verification.`
- `Try again.`
- `Use password login instead.`

## Voice-guided Face Recognition flow

```text
User: “Yukti, sign me in with my face.”
        ↓
Yukti opens Face Recognition mode
        ↓
Yukti requests username if missing
        ↓
User speaks or types username
        ↓
Yukti asks permission to open camera
        ↓
User confirms
        ↓
Browser requests camera permission
        ↓
Yukti speaks positioning instructions
        ↓
System captures live frames
        ↓
Backend performs liveness and face verification
        ↓
Django creates the session on success
        ↓
Yukti confirms successful sign-in
        ↓
React navigates to dashboard without refresh
```

## Example spoken guidance

- `Please place your face inside the frame.`
- `Move slightly closer to the camera.`
- `Make sure only one person is visible.`
- `Look directly at the camera.`
- `Checking that this is a live face.`
- `Verifying your identity.`
- `Face verified successfully. Opening your dashboard.`
- `I could not verify your face. You can try again or use your password.`

Yukti must not claim success until the backend returns a successful verification and Django session creation response.

---

# 14. EMPLOYEE REGISTRATION

## Registration heading

> Employee Registration

Supporting text:

> Create your Digital AI Workspace account.

Use a step-based registration wizard for clarity.

Suggested steps:

1. Account Details
2. Employee Details
3. Face Enrollment
4. Review and Submit

Yukti must be available during every registration step through text and voice.

---

# 15. REGISTRATION STEP 1 — ACCOUNT DETAILS

Required fields:

- Username
- Work Email
- Password
- Confirm Password

Yukti voice assistance may:

- Open the step
- Read field labels
- Explain password requirements
- Fill username from dictation
- Fill work email from dictation
- Focus the password field
- Explain validation errors
- Navigate to the next field

Yukti must not:

- Capture the password through speech
- Read the password aloud
- Save the password in voice transcripts
- Submit the registration without user confirmation

Example commands:

- `Set my username to brahmesh.aptekar.`
- `My work email is brahmesh at example dot com.`
- `What are the password requirements?`
- `Move to the next field.`
- `Show the password.`
- `Hide the password.`

Normalize spoken email carefully, but always display it for confirmation before proceeding.

---

# 16. REGISTRATION STEP 2 — EMPLOYEE DETAILS

Fields:

- Employee ID — required
- First Name — required
- Last Name — required
- Work Title / Designation — required
- Department — required
- Location — required
- Reporting Manager — optional
- Date of Joining — required
- Phone Number — optional
- Date of Birth — optional
- Profile Photo — optional

Use the label `Reporting Manager`.

## Yukti voice-assisted form filling

Yukti may collect one field at a time.

Example conversation:

```text
Yukti: “Please tell me your Employee ID.”
User: “M1 dash 1001.”
Yukti: “I entered M1-1001. Is that correct?”
User: “Yes.”

Yukti: “What is your first name?”
User: “Brahmesh.”
Yukti: “First name set to Brahmesh.”
```

## Supported voice commands

- `My Employee ID is M1-1001.`
- `My first name is Brahmesh.`
- `My last name is Aptekar.`
- `My designation is Senior Web Developer.`
- `My department is Digital Operations.`
- `My location is India.`
- `My manager is Raj.`
- `My joining date is 28 July 2026.`
- `My phone number is ...`
- `My date of birth is ...`
- `Skip this optional field.`
- `Go back.`
- `Continue.`
- `Review my details.`

## Voice-field confirmation rules

1. Display the recognized value immediately.
2. Read back critical values in a concise way.
3. Require confirmation for dates, email addresses, Employee ID, and phone numbers.
4. Never silently overwrite an existing field.
5. Provide `Undo last voice entry`.
6. Highlight the field updated by voice.
7. Allow manual correction at any time.
8. Do not auto-submit after voice completion.

---

# 17. PROFILE PHOTO

Requirements:

- Clickable placeholder
- File selector
- Selected-image preview
- Remove and replace actions
- Optional field

Allowed formats:

- JPG
- JPEG
- PNG
- WebP

Maximum size:

- 2 MB

Validate extension, MIME type, and image processing on the backend.

Yukti may say:

- `You may upload a profile photo now, or skip it.`
- `The maximum file size is 2 MB.`

Yukti cannot choose a file without the user’s operating-system file picker interaction.

---

# 18. REGISTRATION STEP 3 — FACE RECOGNITION ENROLLMENT

Face Recognition enrollment is mandatory for this implementation.

Display:

> Face Recognition Setup

Supporting text:

> Use your camera to register your face for future login.

Required consent:

```text
[ ] I consent to the processing of my facial data for authentication.
```

Actions and states:

- Open Camera
- Capture Face
- Retake
- Use This Face
- Status: Not Enrolled
- Status: Capturing
- Status: Face Captured
- Status: Enrolled

Do not use the profile photo as the Face Recognition credential.

Capture separate live camera frames.

## Yukti voice support during enrollment

Supported commands:

- `Explain face enrollment.`
- `I consent to face enrollment.`
- `Open the camera.`
- `Start capture.`
- `Retake my face.`
- `Use these captures.`
- `Cancel enrollment.`

Even when the user speaks consent, the UI must visibly update the consent control and ask for a final confirmation before camera capture.

Example flow:

```text
Yukti: “Face Recognition uses live camera images to create an encrypted face representation for login. Do you consent?”
User: “Yes, I consent.”
Yukti: “Consent selected. Please review the checkbox and say ‘Open the camera’ when ready.”
```

---

# 19. FACE ENROLLMENT TECHNICAL FLOW

Use browser `navigator.mediaDevices.getUserMedia()`.

Requirements:

1. Request camera permission only after user action.
2. Show a live preview.
3. Stop all camera tracks when the modal closes.
4. Stop camera tracks after capture.
5. Handle camera permission denial.
6. Handle unavailable camera.
7. Detect no face.
8. Detect multiple faces.
9. Capture at least three frames at short intervals.
10. Run anti-spoofing.
11. Validate frame consistency.
12. Generate facial embeddings.
13. Encrypt the approved embedding.
14. Delete all temporary frames after processing.

Suggested camera guidance:

- Look directly at the camera.
- Keep your face inside the frame.
- Ensure your face is clearly illuminated.
- Remove sunglasses or items covering your face.
- Only one person should be visible.
- Turn slightly left when requested.
- Turn slightly right when requested.

Do not authenticate from a single profile image.

---

# 20. REGISTRATION STEP 4 — REVIEW AND SUBMIT

Display a complete review summary:

- Account details excluding passwords
- Employee details
- Profile photo status
- Face enrollment status
- Consent status

Required checkbox:

```text
[ ] I confirm that the entered information is correct.
```

Button:

> Create Account →

Yukti may:

- Read a concise summary
- Navigate to a specific step for correction
- Highlight missing fields
- Explain validation errors
- Ask for final submission confirmation

Example:

```text
User: “Yukti, review my details.”
Yukti: “Your Employee ID is M1-1001, your designation is Senior Web Developer, and Face Recognition enrollment is complete. Two optional fields are empty. Would you like to submit?”
```

Yukti must not submit until the user gives explicit confirmation.

---

# 21. REGISTRATION VALIDATION

## Username

- Required
- Minimum 4 characters
- Maximum 50 characters
- Unique
- No spaces
- Permit letters, numbers, dots, underscores, and hyphens

Suggested regex:

```text
^[A-Za-z0-9._-]{4,50}$
```

## Employee ID

- Required
- Maximum 50 characters
- Unique
- Letters, numbers, and hyphens

## Work Email

- Required
- Valid email format
- Unique
- Do not restrict to one domain unless configured

## Password

- Required
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- Confirm password must match
- Use Django password hashing
- Never save plain text

## Phone

- Store as string
- Allow international prefixes

## Date of birth

- Optional
- Cannot be in the future

## Date of joining

- Required
- Must be a valid date

## Face consent

- Required before enrollment

## Final information confirmation

- Required before submission

All validations must run on both frontend and backend.

---

# 22. ATOMIC REGISTRATION

Create the following records in one database transaction:

1. Django user
2. Employee profile
3. Face credential

If any required step fails:

- Roll back the full registration.
- Do not leave a partial user.
- Delete temporary biometric frames.
- Return a safe validation response.

Use Django-supported user creation, such as:

```python
User.objects.create_user(...)
```

Never assign raw passwords directly.

After registration, show:

> Registration completed successfully. You can now sign in using your username and password or Face Recognition.

Provide:

> Go to Sign In →

Do not automatically log the user in unless the existing architecture explicitly requires it.

---

# 23. FACE RECOGNITION LOGIN

Face login uses:

- Username
- Live camera verification

Do not search the complete employee database using only a face.

Use one-to-one verification:

```text
Username → Enrolled FaceCredential → Live Captured Face
```

## Flow

1. User enters or speaks username.
2. User clicks or says `Sign in with Face Recognition`.
3. Validate username is present.
4. Open accessible camera modal.
5. Request camera permission.
6. Capture three live frames.
7. Verify exactly one face.
8. Perform anti-spoofing.
9. Generate temporary embeddings.
10. Retrieve encrypted enrolled embedding for the username.
11. Decrypt only during backend verification.
12. Compare embeddings.
13. Check that the account is active.
14. Apply failed-attempt rules.
15. If verified, create normal Django session.
16. Return authenticated user details.
17. React updates authentication state.
18. Navigate to `/dashboard` without refresh.
19. Delete temporary frames.

---

# 24. FACE LOGIN MODAL

Suggested layout:

```text
┌────────────────────────────────────────────┐
│ Sign in with Face Recognition          X  │
├────────────────────────────────────────────┤
│                                            │
│            Live Camera Preview             │
│                                            │
│       Keep your face inside the frame      │
│                                            │
│          Checking live face...             │
│                                            │
├────────────────────────────────────────────┤
│ Username: current.username                  │
│                                            │
│ [ Cancel ]       [ Verify My Face → ]      │
└────────────────────────────────────────────┘
```

Required states:

- Idle
- Requesting camera permission
- Opening camera
- Camera ready
- Capturing
- Checking face
- Checking liveness
- Verifying identity
- Verified
- Failed
- Locked
- Camera denied
- Camera unavailable

Messages:

- `Opening camera...`
- `Position your face inside the frame.`
- `Move closer to the camera.`
- `Only one person should be visible.`
- `Checking whether the face is live...`
- `Verifying your identity...`
- `Face verified successfully.`
- `Redirecting to dashboard...`

Errors:

- `Camera permission was denied.`
- `No camera was detected.`
- `No face was detected. Position your face inside the frame.`
- `Multiple faces were detected. Only one person should be visible.`
- `We could not verify your identity. Try again or use your password.`
- `Face Recognition has not been enrolled for this account.`
- `Face Recognition is temporarily locked after multiple failed attempts.`

Do not expose similarity scores, thresholds, stored biometric data, or model internals.

---

# 25. ANTI-SPOOFING

Anti-spoofing is mandatory.

Implement:

- DeepFace `anti_spoofing=True` where supported
- Three-frame live capture
- Exactly one face per frame
- Consistency checks across frames
- Fail-closed behaviour if liveness cannot be completed

Optional when reliable:

- Blink challenge
- Slight left/right head movement

Do not fake liveness with a visual animation that is not validated by the backend.

If the installed DeepFace version does not support the intended anti-spoofing path:

1. Detect the incompatibility.
2. Document it clearly.
3. Use the nearest supported DeepFace anti-spoofing flow.
4. Do not report verification success without a liveness result.
5. Keep password login available.

---

# 26. FACE RECOGNITION SERVICE

Create a clear service abstraction, for example:

```text
FaceRecognitionService
```

Responsibilities:

- Validate image inputs
- Detect faces
- Reject zero faces
- Reject multiple faces
- Run anti-spoofing
- Align the face
- Generate embeddings
- Compare embeddings
- Return typed safe results
- Delete temporary files
- Hide internal library exceptions from the frontend

Suggested methods:

```text
enroll_face(frames)
verify_face(stored_embedding, frames)
extract_embedding(frame)
check_liveness(frame)
validate_single_face(frame)
compare_embeddings(registered, captured)
```

Suggested result:

```json
{
  "success": true,
  "verified": true,
  "liveness_passed": true,
  "failure_code": null
}
```

Failure codes:

- `CAMERA_FRAME_INVALID`
- `NO_FACE`
- `MULTIPLE_FACES`
- `LIVENESS_FAILED`
- `FACE_NOT_ENROLLED`
- `FACE_NOT_MATCHED`
- `ACCOUNT_DISABLED`
- `TEMPORARILY_LOCKED`
- `SERVICE_ERROR`

Do not return raw DeepFace exceptions.

---

# 27. BIOMETRIC STORAGE

Create a `FaceCredential` model with fields such as:

- id
- user — one-to-one
- encrypted_embedding
- model_name
- embedding_version
- is_enrolled
- consent_given
- consent_timestamp
- failed_attempts
- locked_until
- enrolled_at
- last_verified_at
- created_at
- updated_at

Store embeddings in encrypted form.

Environment variable example:

```text
FACE_EMBEDDING_ENCRYPTION_KEY=
```

Use an established encryption implementation such as Fernet when compatible.

Rules:

1. Never hard-code the encryption key.
2. Never return embeddings through APIs.
3. Never log embeddings.
4. Never store login frames permanently.
5. Do not use raw profile photographs as authentication credentials.
6. Delete temporary files in `finally` cleanup logic.
7. Deleting a user must delete FaceCredential.
8. Authenticated users can remove and re-enroll their face.

---

# 28. FACE LOGIN ATTEMPT CONTROL

Create `FaceLoginAttempt` records with safe metadata.

Suggested fields:

- id
- user, nullable
- username hash or safely handled username
- success
- failure reason
- attempted_at
- IP address where appropriate
- user-agent summary where appropriate

Never log:

- Captured frames
- Embeddings
- Passwords
- Encryption keys
- Session cookies
- Raw audio

Default lockout:

- Maximum failures: 5
- Lock duration: 15 minutes

Rules:

1. Face lockout must not block password login.
2. Successful face login resets failed attempts.
3. Configuration comes from environment or settings.

---

# 29. REQUIRED DATABASE MODELS

## Django User

Store:

- Username
- Password hash
- Email
- First name
- Last name
- Active status
- Staff status
- Date joined
- Last login

## EmployeeProfile

Store:

- user — one-to-one
- employee_id — unique
- profile_photo
- designation
- department
- location
- reporting_manager
- joining_date
- phone_number
- date_of_birth
- created_at
- updated_at

## FaceCredential

Store:

- user — one-to-one
- encrypted_embedding
- model_name
- embedding_version
- is_enrolled
- consent_given
- consent_timestamp
- failed_attempts
- locked_until
- enrolled_at
- last_verified_at
- created_at
- updated_at

## FaceLoginAttempt

Store:

- user, nullable
- success
- failure_reason
- attempted_at
- safe request metadata

Use proper indexes, constraints, relationships, and cleanup behaviour.

---

# 30. REQUIRED BACKEND ENDPOINTS

## Authentication

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

## Profile

```http
GET   /api/v1/profile
PATCH /api/v1/profile
POST  /api/v1/profile/photo
```

## Face Recognition

```http
POST   /api/v1/auth/face/enroll
GET    /api/v1/auth/face/status
POST   /api/v1/auth/face/verify
DELETE /api/v1/auth/face/enrollment
```

## Yukti help and voice-intent processing

```http
POST /api/v1/yukti/help
POST /api/v1/yukti/intent
```

For the MVP, the frontend may process simple voice commands locally and call the backend only when required.

The backend must validate all actions and permissions.

## Face verification request

Use `multipart/form-data` with:

- username
- face_frame_1
- face_frame_2
- face_frame_3

Success response:

```json
{
  "success": true,
  "message": "Face verified successfully.",
  "user": {
    "id": 1,
    "username": "employee.username",
    "first_name": "Employee",
    "last_name": "Name"
  },
  "redirect_to": "/dashboard"
}
```

Safe failure response:

```json
{
  "success": false,
  "code": "FACE_NOT_MATCHED",
  "message": "We could not verify your identity. Try again or use your password."
}
```

Do not expose stack traces in production.

---

# 31. YUKTI INTENT MODEL

Implement a deterministic, rule-based intent router for Module-1. Do not require an external LLM.

Suggested intents:

```text
OPEN_LOGIN
OPEN_REGISTRATION
OPEN_FACE_LOGIN
START_CAMERA
STOP_CAMERA
START_FACE_CAPTURE
RETRY_FACE_CAPTURE
USE_PASSWORD_LOGIN
SET_USERNAME
SET_WORK_EMAIL
SET_EMPLOYEE_ID
SET_FIRST_NAME
SET_LAST_NAME
SET_DESIGNATION
SET_DEPARTMENT
SET_LOCATION
SET_REPORTING_MANAGER
SET_JOINING_DATE
SET_PHONE_NUMBER
SET_DATE_OF_BIRTH
NEXT_FIELD
PREVIOUS_FIELD
NEXT_STEP
PREVIOUS_STEP
SKIP_OPTIONAL_FIELD
REVIEW_REGISTRATION
SUBMIT_LOGIN
SUBMIT_REGISTRATION
OPEN_DASHBOARD
OPEN_PROFILE
OPEN_EMPLOYEES
OPEN_SETTINGS
LOGOUT
HELP
STOP_SPEAKING
CANCEL
```

Each intent must define:

- Whether it is allowed before login
- Whether confirmation is required
- Which UI action it triggers
- Whether backend validation is required
- Safe spoken response

Example intent result:

```json
{
  "intent": "SET_EMPLOYEE_ID",
  "value": "M1-1001",
  "confidence": 0.92,
  "requires_confirmation": true,
  "spoken_response": "I entered M1-1001 as your Employee ID. Is that correct?"
}
```

Do not use confidence alone for security-sensitive actions.

---

# 32. SESSION AND AUTHENTICATION REQUIREMENTS

Use Django authentication and server-side sessions.

After successful password or Face Recognition verification:

1. Call the supported Django login mechanism.
2. Create a normal authenticated session.
3. Return current-user details.
4. Ensure the same protected routes work for both methods.

Logout must:

1. Invalidate the server-side session.
2. Clear frontend auth state.
3. Navigate to `/login`.
4. Stop camera tracks.
5. Stop microphone recognition.
6. Stop speech synthesis.
7. Clear sensitive temporary state.

Use:

- CSRF protection
- Secure production cookies
- HttpOnly cookies
- HTTPS
- Appropriate SameSite settings

Do not store authentication tokens in local storage unless the existing architecture already requires it and the decision is clearly justified.

---

# 33. DASHBOARD SHELL

After login, build:

```text
┌────────────────────┬───────────────────────────────────────────┐
│ MarketOne Logo     │ Search / Ask Yukti   Mic  Bell Profile Out│
├────────────────────┼───────────────────────────────────────────┤
│ Dashboard          │                                           │
│ Employees          │                                           │
│ Performance        │          Selected Module Content          │
│ Recognition        │                                           │
│ Landing Pages      │                                           │
│ Email Builder      │                                           │
│ Personal Finance   │                                           │
│ AI Assistants      │                                           │
│ Reports            │                                           │
│ Administration     │                                           │
│                    │                                           │
│ Settings           │                                           │
│ Logout             │                                           │
├────────────────────┴───────────────────────────────────────────┤
│ Privacy | Terms | Help                   © MarketOne           │
└────────────────────────────────────────────────────────────────┘
```

Initial dashboard content:

- Welcome message
- Profile photo or initials
- Employee ID
- Designation
- Department
- Location

Quick access:

- My Profile
- Employees
- Ask Yukti

Do not add unnecessary charts.

---

# 34. YUKTI AFTER LOGIN

Yukti may:

- Navigate to allowed routes
- Explain module placeholders
- Open profile
- Explain how to update profile information
- Explain Face Recognition status
- Start re-enrollment flow after user confirmation
- Help locate settings
- Read a concise summary of dashboard information the user is already authorized to view

Example voice commands:

- `Yukti, open my profile.`
- `Open Employees.`
- `Show my Face Recognition status.`
- `Help me re-enroll my face.`
- `Open settings.`
- `Log me out.`

Sensitive actions require confirmation.

Example:

```text
User: “Yukti, log me out.”
Yukti: “Would you like me to log you out now?”
User: “Yes.”
Yukti performs logout through the normal authenticated logout endpoint.
```

Yukti must never bypass permissions.

---

# 35. USER PROFILE

Display:

- Profile photo
- Username
- Work email
- Employee ID
- First name
- Last name
- Designation
- Department
- Location
- Reporting Manager
- Joining date
- Phone
- Date of birth
- Face Recognition enrollment status

Allow updates only to permitted fields.

Do not allow normal profile editing of:

- Username unless explicitly supported
- Employee ID
- Password
- Encrypted face embedding
- Internal security fields

Face controls:

- View enrollment status
- Re-enroll face
- Remove face enrollment

Re-enrollment and removal require authenticated session and confirmation.

---

# 36. FRONTEND STATE MANAGEMENT

Create a clean state architecture such as:

- `AuthContext`
- `useAuth`
- `YuktiContext`
- `useYuktiVoice`
- `useSpeechRecognition`
- `useSpeechSynthesis`
- `useCamera`
- `ProtectedRoute`

Required authentication functions:

```text
checkSession()
loginWithPassword()
loginWithFace()
logout()
register()
refreshCurrentUser()
```

Required Yukti functions:

```text
startListening()
stopListening()
speak(text)
stopSpeaking()
processVoiceCommand(transcript)
confirmPendingAction()
cancelPendingAction()
fillRegistrationField(field, value)
navigateByIntent(intent)
```

Handle:

- Initial session loading
- Authenticated state
- Unauthenticated state
- Expired session
- Network errors
- Validation errors
- Camera errors
- Face service errors
- Microphone errors
- Unsupported speech recognition
- Interrupted speech synthesis

---

# 37. ACCESSIBILITY REQUIREMENTS

1. Semantic HTML.
2. Proper labels for all form fields.
3. Visible keyboard focus.
4. Keyboard-operable modals.
5. Escape closes non-critical modals safely.
6. Screen-reader announcements for validation errors.
7. Screen-reader announcements for listening and processing states.
8. Do not rely only on colour.
9. Provide text alternatives to microphone and camera icons.
10. Provide captions/transcripts for Yukti’s spoken responses.
11. Provide mute and stop-speaking controls.
12. Avoid automatic speech on initial page load.
13. Use accessible live regions for voice status.
14. Ensure colour contrast meets WCAG AA where practical.

---

# 38. SECURITY REQUIREMENTS

Mandatory protections:

1. Django password hashing.
2. Backend validation for every input.
3. Unique username, email, and Employee ID.
4. Protected dashboard routes.
5. CSRF protection.
6. HTTPS in deployment.
7. Image file validation.
8. No password logging.
9. No biometric embedding logging.
10. No permanent login-frame storage.
11. Encrypt biometric embeddings.
12. Explicit facial-data consent.
13. Anti-spoofing.
14. Face-login rate limiting and lockout.
15. Password fallback.
16. Disabled accounts cannot authenticate.
17. Delete FaceCredential when user is deleted.
18. Stop camera after use.
19. Stop microphone after use.
20. Do not store raw audio.
21. Do not commit `.env`.
22. Safe production error handling.
23. Prevent account enumeration.
24. Yukti cannot override authentication.
25. Database transaction for registration.
26. Require confirmation before voice-triggered submission.
27. Passwords cannot be dictated through voice.
28. Yukti must never speak secret values.
29. Voice commands cannot change biometric thresholds.
30. Voice commands cannot skip liveness checks.

---

# 39. ERROR HANDLING

Use a consistent API error format:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Please correct the highlighted fields.",
  "errors": {
    "username": ["This username is already registered."]
  }
}
```

Create frontend handling for:

- Field validation errors
- Form-level errors
- Camera errors
- Face errors
- Microphone permission errors
- Speech recognition errors
- Unsupported browser features
- Network errors
- Server errors
- Session expiry

Prevent duplicate submissions and show loading states.

---

# 40. REQUIRED TESTING

## Backend tests — registration and password login

- Successful registration
- Duplicate username
- Duplicate email
- Duplicate Employee ID
- Invalid password
- Password mismatch
- Invalid dates
- Atomic rollback
- Successful password login
- Invalid password login
- Disabled account login
- Logout
- Protected-route access

## Backend tests — Face Recognition

- Successful enrollment
- Enrollment without consent
- No face detected
- Multiple faces detected
- Liveness failure
- Successful matching face login
- Non-matching face
- Non-enrolled account
- Disabled account
- Temporary lock after failures
- Password login works during face lockout
- Temporary frame cleanup
- Embedding never appears in API response

## Frontend tests

- Login validation
- Registration-step validation
- Show/hide password
- Camera permission denial
- Face-modal states
- Successful password login navigation
- Successful face login navigation
- Protected route
- Logout
- Responsive navigation drawer

## Yukti voice tests

- Microphone permission denied
- Unsupported browser
- Start and stop listening
- Transcript displayed
- Open login command
- Open registration command
- Set username command
- Fill registration field command
- Date confirmation
- Email confirmation
- Password dictation rejected
- Face-login initiation
- Camera opening requires confirmation
- Submit login requires confirmation
- Submit registration requires confirmation
- Logout requires confirmation
- Unknown command fallback
- Speech synthesis stop/mute
- Microphone stops on navigation and logout

Mock heavyweight Face Recognition model execution in standard unit tests. Provide an optional integration or manual test for the real model.

---

# 41. REQUIRED DOCUMENTATION

Create or update the README with:

1. Module-1 overview
2. Architecture
3. Folder structure
4. Required software
5. Windows 10 PowerShell setup
6. Python virtual environment setup
7. Frontend installation
8. Backend installation
9. PostgreSQL configuration
10. Environment variables
11. Database migrations
12. Creating a superuser
13. Starting Django
14. Starting React
15. Starting FastAPI if used
16. Face model first-run download warning
17. Camera and HTTPS requirements
18. Microphone permission requirements
19. Browser support for speech recognition
20. Registration process
21. Voice-assisted registration
22. Password login process
23. Voice-guided login
24. Face enrollment process
25. Face login process
26. Voice-guided Face login
27. Running tests
28. Known MVP limitations
29. Troubleshooting

Document these environment settings:

```text
DJANGO_SECRET_KEY=
DJANGO_DEBUG=
DJANGO_ALLOWED_HOSTS=
DATABASE_URL=
CORS_ALLOWED_ORIGINS=
CSRF_TRUSTED_ORIGINS=
FACE_EMBEDDING_ENCRYPTION_KEY=
FACE_MODEL_NAME=Facenet512
FACE_DETECTOR_BACKEND=retinaface
FACE_DISTANCE_METRIC=cosine
FACE_MAX_FAILED_ATTEMPTS=5
FACE_LOCK_MINUTES=15
FRONTEND_URL=
YUKTI_VOICE_ENABLED=true
YUKTI_SPEECH_LANGUAGE=en-IN
```

Do not place real secret values in `.env.example` or README.

---

# 42. IMPLEMENTATION PHASES

## Phase 1 — Repository inspection and foundation

- Inspect project
- Confirm architecture
- Configure environment variables
- Confirm database
- Add design tokens
- Create shared layouts

## Phase 2 — Django models and authentication

- User integration
- EmployeeProfile
- FaceCredential
- FaceLoginAttempt
- Migrations
- Django Admin
- Password login
- Logout
- Current-user endpoint

## Phase 3 — Registration

- Step-based registration UI
- Backend serializer/form
- Atomic creation
- Profile photo
- Validation
- Review screen
- Success screen

## Phase 4 — Face Recognition service

- Image input handling
- Temporary cleanup
- Single-face validation
- Anti-spoofing
- Embedding generation
- Encryption
- Enrollment
- Verification
- Lockout

## Phase 5 — Frontend Face Recognition

- Camera hook
- Accessible modal
- Multi-frame capture
- Enrollment UI
- Login UI
- Error handling
- Stop camera tracks

## Phase 6 — Yukti text assistant

- Help panel
- Rule-based FAQ
- Login guidance
- Registration guidance
- Face Recognition guidance

## Phase 7 — Yukti voice assistant

- Speech-recognition hook
- Speech-synthesis hook
- Microphone permission handling
- Voice transcript panel
- Intent router
- Voice login assistance
- Voice Face Recognition assistance
- Registration field dictation
- Field confirmation
- Submission confirmations
- Stop and mute controls
- Unsupported-browser fallback

## Phase 8 — Dashboard shell

- AuthContext
- Protected routes
- Header
- Sidebar
- Footer
- Dashboard
- Profile
- Module placeholders
- Responsive drawer

## Phase 9 — Testing and verification

- Backend tests
- Frontend tests
- Yukti voice tests
- Migrations
- Lint
- Type checking
- Production build
- Manual webcam test
- Manual microphone test
- Fix defects

---

# 43. DEFINITION OF DONE

Module-1 is complete only when:

1. Landing page works on desktop, tablet, and mobile.
2. MarketOne logo opens the official website in a new tab.
3. Login and registration change without full-page refresh.
4. User can register with all required details.
5. User can upload a profile photo.
6. User can fill supported registration fields by voice.
7. Voice-filled values are visible and confirmable.
8. Password cannot be captured through voice.
9. User can give facial-data consent.
10. User can enroll a live face.
11. Enrollment rejects zero faces.
12. Enrollment rejects multiple faces.
13. Enrollment rejects failed liveness.
14. Encrypted face embedding is stored.
15. Raw login frames are deleted.
16. User can log in with username and password.
17. User can ask Yukti to guide password login.
18. User can log in with username and Face Recognition.
19. User can ask Yukti to initiate Face Recognition login.
20. Face login uses live webcam frames.
21. Face login performs anti-spoofing.
22. Matching face creates Django session.
23. Non-matching face is rejected.
24. Repeated failures trigger temporary face lockout.
25. Password login remains available.
26. Disabled users cannot authenticate.
27. Successful login opens `/dashboard` without refresh.
28. Protected routes work.
29. Sidebar navigation changes main content only.
30. User can view profile.
31. User can view Face Recognition status.
32. User can remove and re-enroll face.
33. User can communicate with Yukti through text.
34. User can communicate with Yukti through voice.
35. Yukti speaks responses when enabled.
36. Voice transcript is visible.
37. Microphone starts only after user action.
38. Microphone stops after completion, cancellation, navigation, and logout.
39. Yukti requires confirmation for submissions and logout.
40. Yukti cannot bypass authentication or permissions.
41. User can log out securely.
42. No passwords, biometric embeddings, raw audio, or secrets appear in logs.
43. Tests pass.
44. Frontend production build succeeds.
45. Windows 10 setup and run instructions are documented.

---

<!-- UI-DESIGN-DOD-START -->

# 43A. UI/UX DESIGN DEFINITION OF DONE

The visual implementation is complete only when:

1. All 12 reference workflow screens are represented by working application routes or states.
2. Yukti text-and-voice assistant design is available on public, authentication, registration, and authenticated screens.
3. Landing, login, Face Recognition, registration, dashboard, profile, settings, and placeholder pages use one consistent design system.
4. The official MarketOne logo is used and linked correctly.
5. The six approved branding colours are dominant and conflicting old principal colours are removed.
6. Desktop implementation matches the base `1440px` visual hierarchy and spacing.
7. The public sidebar and authenticated application shell match the documented measurements.
8. Registration uses the four-step stepper with completed, active, upcoming, and error states.
9. Every form has focus, validation, loading, disabled, and success states.
10. Camera flows have permission, ready, capturing, processing, success, denied, unavailable, and failure designs.
11. Yukti has idle, listening, processing, confirmation, unsupported, denied, error, mute, and stop-speaking designs.
12. Passwords are never shown in Yukti transcripts or review screens.
13. Voice-filled fields are visibly highlighted and require confirmation where specified.
14. Dashboard navigation updates only the content panel.
15. Mobile and tablet layouts work without horizontal scrolling.
16. Components satisfy the accessibility and keyboard requirements.
17. No page is implemented by displaying a static full-screen mockup image.
18. Visual regression screenshots or an equivalent manual screenshot checklist are produced for the required desktop screens.

<!-- UI-DESIGN-DOD-END -->

---

# 44. FINAL RESPONSE FORMAT

After implementation, provide:

1. Implementation summary
2. Final architecture
3. Files created
4. Files modified
5. Database models created
6. API endpoints created
7. Frontend routes created
8. Face Recognition approach
9. Anti-spoofing approach
10. Encryption approach
11. Yukti text-assistant approach
12. Yukti voice-assistant approach
13. Supported voice commands
14. Browser compatibility and fallbacks
15. Commands executed
16. Migration results
17. Test results
18. Frontend build result
19. Manual password-login test procedure
20. Manual face-enrollment test procedure
21. Manual Face Recognition login test procedure
22. Manual Yukti voice test procedure
23. Known limitations
24. Remaining enhancements
25. Exact Windows PowerShell commands to run the full application

Do not provide only example code or a plan. Implement the complete working Module-1.

---

# FOLLOW-UP COMMANDS FOR CLAUDE CODE / CODEX

## Initial execution command

```text
Start by inspecting the complete repository and report the current frontend,
backend, database, authentication, routing, styling, Face Recognition, and
voice-assistant structure. Then implement Module-1 phase by phase. Do not stop
after analysis or planning. Preserve existing working code and begin with the
database models, authentication endpoints, branding foundation, and reusable
frontend layouts.
```

## Continue when the agent stops after planning

```text
Proceed with implementation now. Start with the first incomplete phase, create
the required files, run migrations and tests, fix errors, and continue until
Module-1 satisfies the complete Definition of Done. Do not repeat the full
plan.
```

## Correction when Face Recognition is skipped

```text
Face Recognition is mandatory for Module-1. Implement live webcam enrollment,
explicit consent, multi-frame capture, anti-spoofing, encrypted embedding
storage, username-based one-to-one verification, Django session creation,
failed-attempt lockout, temporary-frame cleanup, password fallback, and all
required tests. Do not replace it with a placeholder.
```

## Correction when Yukti voice functionality is skipped

```text
Yukti voice communication is mandatory for Module-1. Implement push-to-talk
speech recognition, speech synthesis, visible transcripts, microphone
permission handling, voice-guided password login, voice-guided Face Recognition
login, voice-assisted registration field completion, field-value confirmation,
submission confirmation, microphone cleanup, mute/stop controls, unsupported
browser fallback, and tests. Do not replace it with a decorative microphone
button.
```

## Correction when the agent accepts passwords by voice

```text
Do not accept, store, transcribe, log, or speak passwords through Yukti voice
input. Yukti may guide the user and focus the password field, but the password
must be entered manually. Keep confirmation and deterministic backend
authentication in place.
```

## Final verification command

```text
Run the complete backend test suite, frontend tests, linting, TypeScript checks,
Django system checks, migrations, and frontend production build. Fix every
error that can be fixed locally. Then provide the final implementation report,
manual webcam test steps, manual microphone test steps, known limitations, and
exact Windows PowerShell startup commands.
```

---

# MVP LIMITATIONS TO DOCUMENT HONESTLY

The completed implementation should clearly document:

1. Browser speech recognition support varies by browser.
2. Push-to-talk is used instead of always-on wake-word listening.
3. Browser speech recognition quality depends on microphone quality, accent, noise, and network/browser implementation.
4. Face Recognition accuracy depends on camera quality, lighting, pose, and model behaviour.
5. Anti-spoofing reduces risk but does not make the system impossible to attack.
6. Password login remains the fallback.
7. Face and voice features require explicit browser permissions.
8. Production deployment must use HTTPS.
9. Legal/privacy review may be required before production use of employee biometric data.
10. Yukti assists the workflow but never makes authentication or authorization decisions.

