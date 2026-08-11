You are working on my existing "Mobile Device Studio" desktop application.

I attached a reference image showing the exact visual direction I want.

Your task is to implement a FULL production-ready Maestro Automation Studio
based on that reference image.

IMPORTANT:
The attached screenshot is the PRIMARY UI/UX reference.

Do not redesign the entire application.
Do not create a separate new app.
Integrate this into the existing Mobile Device Studio architecture.

Before changing any code:
1. Inspect the repository.
2. Understand the current frontend architecture.
3. Understand Tauri/backend commands.
4. Find existing ADB/device management.
5. Find current Script Manager.
6. Find existing Maestro integration.
7. Find existing scrcpy integration.
8. Find persistence/storage patterns.
9. Find reusable UI components/design tokens.
10. Report the implementation plan.

Then implement it.

========================================================
PRODUCT GOAL
========================================================

Build a Visual Mobile Automation Studio around Maestro.

The user should be able to build automation without knowing YAML.

Main workflow:

Connect Android device
        ↓
Open Script Manager
        ↓
Open Maestro Builder
        ↓
See real device preview
        ↓
Turn on Inspect mode
        ↓
Click an element on the device
        ↓
See:
- text
- resource ID
- content description
- bounds
- enabled state
- visibility
        ↓
Choose:
- Tap
- Assert Visible
- Input Text
- Long Press
- Scroll Until Visible
        ↓
Action automatically appears in Flow Builder
        ↓
Generated Maestro YAML updates automatically
        ↓
Press Run
        ↓
Execute Maestro CLI against selected device
        ↓
Show live step execution
        ↓
PASS / FAIL
        ↓
Screenshots / video / logs / artifacts / history

The product should feel like:

"Postman + Appium Inspector + Maestro Studio + Device Farm"

inside Mobile Device Studio.

========================================================
REFERENCE LAYOUT
========================================================

Follow the attached screenshot closely.

Desktop layout:

┌──────────────────────────────────────────────────────────────────────┐
│ Mobile Device Studio                     Device / ADB / SCRCPY      │
├──────────────┬───────────────────────────────────────────────────────┤
│              │                                                       │
│ Sidebar      │ Maestro Builder toolbar                              │
│              │                                                       │
│ Dashboard    │ Flow Name / Package / Tags                           │
│ Devices      │                                                       │
│ Sessions     ├────────────┬───────────────┬───────────────┐          │
│ Screenshots  │ Actions    │ Device        │ Flow Builder  │Inspector│
│ Recordings   │ Library    │ Preview       │               │         │
│              │            │               │               │         │
│ Automation   │ Commands   │ Real Screen   │ Action Cards  │Tree     │
│ Script Mgr   │            │               │               │Element  │
│ Scheduler    │            │               │               │Details  │
│              └────────────┴───────────────┴───────────────┘          │
│ Tools                                                                 │
│ ...          ┌─────────────────────┬──────────────────────┐          │
│              │ YAML Preview        │ Run History          │          │
│              └─────────────────────┴──────────────────────┘          │
└──────────────┴───────────────────────────────────────────────────────┘

Keep the existing dark theme.

Use the existing app's:
- typography
- sidebar
- border radius
- border colors
- spacing
- button styles
- icon library
- status colors

Do NOT introduce an unrelated design system.

========================================================
TOP TOOLBAR
========================================================

At the top of Maestro Builder show:

Flow Name
[ Payment Success Flow ]

App Package
[ com.laundryyou.washxpress.dev ]

Tags
[ smoke ] [ payment ] [+]

Actions:

[ Import YAML ]
[ Export YAML ]
[ Save Flow ]

Device information should come from the currently selected device.

========================================================
MAIN WORKSPACE
========================================================

Create four primary panels.

1. ACTION LIBRARY
2. DEVICE PREVIEW
3. FLOW BUILDER
4. ELEMENT INSPECTOR

And two bottom panels:

5. YAML PREVIEW
6. RUN HISTORY

Panels should be resizable if an existing splitter/resizable system
already exists.

Do not add a large dependency only for resizing unless necessary.

========================================================
1. ACTION LIBRARY
========================================================

Create a searchable Maestro command palette.

Header:

ACTIONS

[ + Add Action ]

Search:
[ Search actions... ]

Categories:

COMMON

- Launch App
- Tap Element
- Input Text
- Assert Visible
- Wait For Element
- Screenshot

INTERACTION

- Tap
- Double Tap
- Long Press
- Back
- Press Key

INPUT

- Input Text
- Erase Text
- Paste Text
- Hide Keyboard
- Copy Text
- Random Email
- Random Person Name
- Random Number
- Random Text
- Random City
- Random Country
- Random Color

ASSERTIONS

- Assert Visible
- Assert Not Visible
- Assert True
- Assert Screenshot

GESTURES

- Scroll
- Scroll Until Visible
- Swipe

APP & STATE

- Launch App
- Stop App
- Kill App
- Clear State
- Clear Keychain
- Open Link

WAIT & FLOW CONTROL

- Wait For Animation
- Extended Wait Until
- Repeat
- Retry
- Run Flow
- Run Script
- Eval Script

DEVICE

- Set Permissions
- Set Location
- Set Orientation
- Set Clipboard
- Airplane Mode
- Toggle Airplane Mode
- Travel

MEDIA & DEBUG

- Screenshot
- Start Recording
- Stop Recording
- Add Media

AI

Only expose AI-related actions if supported by the installed
Maestro version.

Do not fake unsupported commands.

========================================================
COMMAND REGISTRY
========================================================

CRITICAL:

Do NOT hardcode all command forms directly inside React components.

Build a schema-driven command registry.

Example:

type MaestroCommandDefinition = {
  id: MaestroCommandId
  label: string
  description: string
  category: MaestroCommandCategory
  icon?: string

  requiresElement?: boolean

  supportedSelectors?: MaestroSelectorType[]

  fields: MaestroFieldDefinition[]

  serializer?: ...
}

Example:

{
  id: "tapOn",
  label: "Tap Element",
  category: "interaction",
  requiresElement: true,

  supportedSelectors: [
    "id",
    "text",
    "index",
    "point"
  ],

  fields: [
    {
      name: "repeat",
      type: "number",
      optional: true
    }
  ]
}

UI forms must be generated from the registry whenever practical.

Adding a Maestro command in the future should NOT require building
a completely separate component.

========================================================
2. DEVICE PREVIEW
========================================================

The center-left panel should display the currently connected Android
device.

Prefer integrating with the existing scrcpy/device streaming system.

DO NOT create a second device streaming engine.

Display:

DEVICE PREVIEW

[ refresh ]
[ rotate ]
[ screenshot ]
[ fullscreen/expand ]

Phone screen.

Bottom:

1080x2400
Pixel / device model
Scale percentage

[-] slider [+]

========================================================
INSPECT MODE
========================================================

Add:

[ 🎯 Inspect ]

When Inspect mode is active:

- mouse hover over an inspectable element should visually highlight it
- clicking should SELECT the element instead of interacting normally

Selected element should be outlined.

Example:

Confirm payment button gets an outline.

The selected element is then sent to the Element Inspector.

IMPORTANT:

Investigate how the current screen is streamed.

If direct click-to-accessibility-node mapping cannot be reliably
performed through the video stream:

implement coordinate hit-testing against Maestro hierarchy bounds.

Example:

Video click
     ↓
translate preview coordinates
     ↓
actual device coordinates
     ↓
find deepest hierarchy node containing point
     ↓
select hierarchy element

Be careful with:

- aspect ratio
- scaled preview
- device rotation
- navigation bars
- display density
- letterboxing

Do not approximate incorrectly.

========================================================
3. FLOW BUILDER
========================================================

Show actions vertically.

Example:

1  Launch App

2  Tap Element
   Tap on "Scan QR"

   Selector
   [ ID ▼ ] [ scan_qr ]

3  Input Text

   Selector
   [ ID ▼ ] [ machine_code ]

   Text
   [ WXP001 ]

4  Tap Element

   Selector
   [ ID ▼ ] [ normal_wash ]

5  Assert Visible

   Selector
   [ Text ▼ ] [ Washer 01 ]

6  Tap Element

   Selector
   [ ID ▼ ] [ confirm_payment ]

7  Assert Visible

   Selector
   [ Text ▼ ] [ Payment successful ]

8  Screenshot

   Name
   [ payment_success ]

9  Press Key

   Key
   [ Home ▼ ]

========================================================
ACTION CARD
========================================================

Each action card should support:

- command icon
- number
- command name
- short description
- enabled/disabled state

controls:

[ ↑ ]
[ ↓ ]
[ duplicate ]
[ delete ]
[ ⋮ ]

Prefer drag and drop reorder only if the project already includes
a suitable sortable dependency.

Otherwise use up/down controls first.

Collapsed card:

6   Tap Element                         ✓  ⋮
    Tap on "Confirm payment"

Expanded:

6   Tap Element

    Selector
    [ ID ▼ ] [ confirm_payment ] [ 🎯 ]

    Advanced
    ▸ More options

========================================================
ACTION VALIDATION
========================================================

Each action must validate itself.

Examples:

Tap:
selector required

Input Text:
text required

Screenshot:
name required

Set Location:
valid latitude
valid longitude

Wait:
positive timeout

Run Flow:
path required

Invalid cards:

- show warning icon
- highlight invalid field
- show concise validation text

Main Run button must become disabled if the flow is invalid.

Example:

⚠ 2 actions need attention

========================================================
4. ELEMENT INSPECTOR
========================================================

Create two tabs:

[ Hierarchy ]
[ Selected Element ]

Hierarchy view:

Search in hierarchy...

▼ DecorView
  ▼ LinearLayout
    ▼ FrameLayout

       TextView
       WashXpress

       Button
       Scan QR

       EditText
       Machine code

       RadioButton
       Normal Wash

       Button
       Confirm payment

       Button
       Cancel

Selecting a hierarchy row must also select/highlight the corresponding
element on Device Preview.

========================================================
REAL HIERARCHY
========================================================

Use REAL device hierarchy data.

Investigate current installed Maestro CLI.

If the current version supports:

maestro hierarchy

wrap the REAL command through the existing Tauri backend/process layer.

Do not assume its output.

Run it manually during implementation and inspect its exact output.

If a structured format is available, use it.

If not, build a robust parser.

Do not fake hierarchy nodes.

Do not use mock hierarchy in production.

========================================================
SELECTED ELEMENT
========================================================

Show:

SELECTED ELEMENT

Type
android.widget.Button

Text
Confirm payment

Resource ID
confirm_payment

Content Description
Confirm payment button

Enabled
true

Visible
true

Clickable
true

Focusable
false

Bounds
[72,1420][1008,1536]

If values are unavailable, display "—".

Never fabricate them.

========================================================
RECOMMENDED SELECTORS
========================================================

Under the selected element show:

RECOMMENDED SELECTORS

ID
confirm_payment
★★★★★

Content Description
Confirm payment button
★★★★☆

Text
Confirm payment
★★★★☆

Index
3
★★☆☆☆

Point
540,1478
★☆☆☆☆

Selector priority:

1. unique stable resource/accessibility ID
2. unique content description
3. unique visible text
4. relational selector
5. index
6. coordinates

VERY IMPORTANT:

Do not label a selector as unique unless hierarchy analysis verifies it.

========================================================
QUICK ACTIONS
========================================================

Under Inspector:

QUICK ACTIONS

[ Tap ]
[ Assert Visible ]
[ Long Press ]
[ Scroll Until Visible ]
[ Copy Selector ]

Click:

Tap

should immediately generate:

{
 command: "tapOn",
 config: {
   selector: {
      type: "id",
      value: "confirm_payment"
   }
 }
}

and add it to Flow Builder.

========================================================
SELECTOR EDITOR
========================================================

Create reusable:

<MaestroSelectorEditor />

Selector strategies:

- ID
- Text
- Index
- Point
- CSS when supported/applicable

Advanced relational selectors:

- above
- below
- leftOf
- rightOf
- containsChild
- childOf
- containsDescendants

UI:

Selector

[ ID ▼ ]

[ confirm_payment ]

[ 🎯 Pick Element ]

Advanced
▸ Relational selector

Relation
[ below ▼ ]

Related element
[ Total ]

========================================================
INTERNAL FLOW MODEL
========================================================

Do not make YAML the application state.

Use a structured model.

Example:

type MaestroFlow = {
  id: string
  name: string
  appId: string
  tags: string[]
  actions: MaestroAction[]
  createdAt: string
  updatedAt: string
}

type MaestroAction = {
  id: string
  command: MaestroCommandId
  enabled: boolean
  config: Record<string, unknown>
}

type MaestroSelector = {
  type:
    | "id"
    | "text"
    | "index"
    | "point"
    | "css"

  value: string | number

  relation?: MaestroRelation
}

Architecture:

UI
 ↓
Structured MaestroFlow
 ↓
Validator
 ↓
Serializer
 ↓
YAML
 ↓
Temporary flow file
 ↓
Maestro CLI

========================================================
5. YAML PREVIEW
========================================================

Create bottom-left YAML panel.

Example:

YAML PREVIEW

appId: com.laundryyou.washxpress.dev
tags:
  - smoke
  - payment
---
- launchApp

- tapOn:
    id: "scan_qr"

- inputText: "WXP001"

- tapOn:
    id: "normal_wash"

- assertVisible:
    text: "Washer 01"

- tapOn:
    id: "confirm_payment"

- assertVisible:
    text: "Payment successful"

- takeScreenshot: "payment_success"

- pressKey: "HOME"

Buttons:

[ Format YAML ]
[ Copy ]

Additional:

[ Import YAML ]
[ Export YAML ]

========================================================
YAML SERIALIZER
========================================================

Create a dedicated serializer module.

Suggested:

features/maestro/
  model/
    types.ts

  registry/
    commands.ts

  serializer/
    maestroSerializer.ts

  parser/
    maestroParser.ts

  validation/
    maestroValidator.ts

  selectors/
    selectorRecommendation.ts

Do not scatter YAML string concatenation throughout the UI.

The serializer must have unit tests.

========================================================
YAML IMPORT
========================================================

Implement YAML → Visual Flow parsing where feasible.

If an imported Maestro command is supported:

convert it into a visual action.

If it is not supported:

DO NOT DELETE IT.

Represent it as:

Custom YAML

or:

Unsupported Maestro Command

and preserve its source YAML.

Example:

10   Custom YAML
     Unsupported command

     [ Edit YAML ]

This prevents data loss.

========================================================
6. RUNNER
========================================================

Use REAL Maestro CLI.

Do not emulate test execution.

Investigate the installed CLI version first.

Run:

maestro --version

Then inspect help:

maestro --help
maestro test --help

Determine the actual CLI syntax supported by this installation.

Do not invent arguments from memory.

Use the currently selected device.

Runner architecture:

MaestroFlow
     ↓
Validate
     ↓
Serialize YAML
     ↓
write temporary .yaml
     ↓
execute Maestro CLI
     ↓
stream stdout/stderr
     ↓
parse execution state
     ↓
Run UI

========================================================
TAURI BACKEND
========================================================

Use the project's existing process execution abstraction.

Do not create shell commands directly inside frontend code.

Suggested backend interface:

maestro_get_version()

maestro_check_installed()

maestro_get_hierarchy(deviceId)

maestro_run_flow({
  deviceId,
  flowPath,
  outputDirectory?
})

maestro_cancel_run(runId)

maestro_get_run_artifacts(runId)

Names can be adapted to existing conventions.

Security:

- do not interpolate arbitrary shell strings
- pass process arguments safely
- validate paths
- validate device IDs
- avoid shell=true unless absolutely necessary

========================================================
LIVE EXECUTION
========================================================

Top of Flow Builder:

[ ▶ Run ]
[ ‖ Pause ] only if actually supported
[ ■ Stop ]

Do NOT expose Pause if Maestro cannot truly pause execution.

When running:

1 Launch App                          ✓

2 Tap Element                         ✓
  scan_qr

3 Input Text                          ✓
  WXP001

4 Tap Element                         ● Running

5 Assert Visible                      ○

6 Tap Element                         ○

7 Assert Visible                      ○

8 Screenshot                          ○

9 Press Key                           ○

Statuses:

○ Pending
● Running
✓ Passed
✕ Failed
⊘ Skipped

Show:

Running 4 / 9
00:08
Device 23078PND5G

========================================================
TEST FAILURE
========================================================

On failure highlight the failed action.

Example:

7 Assert Visible                      ✕

Expected:
Payment successful

Maestro:
Element not found

[ View Screenshot ]
[ View Logs ]
[ Retry Step ]
[ Edit Action ]

Only expose Retry Step if it can be implemented safely.

Otherwise offer:

[ Run Flow Again ]

========================================================
ARTIFACTS
========================================================

Collect real artifacts if available:

- Maestro output
- screenshots
- screen recordings
- stdout
- stderr
- generated YAML
- logcat when useful
- test duration

Do not assume locations.

Discover artifact paths from real CLI execution/output/configuration.

========================================================
RUN HISTORY
========================================================

Bottom-right:

RUN HISTORY

#142   Payment Success Flow
Device 23078PND5G
PASS
00:01:28
2 minutes ago

#141
PASS

#140
FAIL

Click a run to open details.

Run record:

type MaestroRun = {
  id: string
  flowId: string
  flowName: string

  deviceId: string
  deviceModel?: string
  osVersion?: string

  appId: string

  startedAt: string
  finishedAt?: string

  durationMs?: number

  status:
    | "running"
    | "passed"
    | "failed"
    | "cancelled"

  failedActionId?: string

  stdout?: string
  stderr?: string

  yamlSnapshot: string

  artifacts?: MaestroArtifact[]
}

========================================================
PERSISTENCE
========================================================

Flows must persist after restart.

Reuse the current application's storage architecture.

Do not introduce a database unless necessary.

Support:

- Create Flow
- Save
- Rename
- Duplicate
- Delete
- Import
- Export

Suggested logical grouping:

Maestro Flows

Smoke Tests
  Cold Launch
  App Resume

Authentication
  Login Success
  Invalid OTP
  Logout

Payment
  Payment Success
  Payment Cancel
  Payment Timeout

Scanner
  QR Success
  Invalid QR

========================================================
FLOW TEMPLATES
========================================================

Add optional starter templates:

Blank Flow

Cold Launch

Login Flow

Payment Flow

Smoke Test

Do not hardcode WashXpress behavior into the generic engine.

WashXpress can be a preset/template only.

========================================================
APP PACKAGE
========================================================

When possible auto-detect current foreground package from existing ADB
support.

Allow manual package override.

Example:

App Package
[ com.laundryyou.washxpress.dev ]

[ Use foreground app ]

========================================================
ANDROID ACCESSIBILITY / FLUTTER
========================================================

The target application may be Flutter.

Be prepared for accessibility semantics differences.

If an element does not expose a useful resource ID:

fallback to:

- text
- content description
- relational selectors
- coordinates only as last resort

Inspector should make selector stability clear.

========================================================
SELECTOR STABILITY
========================================================

Show quality indicator.

Examples:

★★★★★ Strong
resource ID unique

★★★★☆ Good
unique text/content description

★★★☆☆ Moderate
relative selector

★★☆☆☆ Fragile
index

★☆☆☆☆ Very fragile
coordinates

Add tooltip explaining why.

========================================================
SEARCH HIERARCHY
========================================================

Element Inspector search should match:

- text
- ID
- content description
- class/type

Example:

Search:
confirm

results:

Button
confirm_payment
Confirm payment

========================================================
ELEMENT ↔ DEVICE SYNC
========================================================

Selection must work both ways.

Hierarchy selection
        ↓
highlight corresponding region on device

Device click
        ↓
select corresponding hierarchy node

Inspector detail updates in both cases.

========================================================
SCREEN COORDINATE MAPPING
========================================================

Implement reliable coordinate conversion.

Maintain:

deviceWidth
deviceHeight

previewWidth
previewHeight

scale
offsetX
offsetY
rotation

Function:

previewPointToDevicePoint()

and:

deviceBoundsToPreviewRect()

Unit test these.

This is critical for element highlighting.

========================================================
COMMAND SEARCH
========================================================

Action search should support fuzzy-ish matching.

Search:

assert

results:

Assert Visible
Assert Not Visible
Assert True
Assert Screenshot
AI Assert

Search:

keyboard

results:

Hide Keyboard
Press Key
Input Text

Do not require exact string matching.

========================================================
KEYBOARD SHORTCUTS
========================================================

If existing desktop app has shortcut handling:

Cmd/Ctrl + S
Save flow

Cmd/Ctrl + Enter
Run flow

Delete
Delete selected action

Cmd/Ctrl + D
Duplicate action

Cmd/Ctrl + F
Focus command/hierarchy search depending active panel

Do not conflict with existing shortcuts.

========================================================
RESPONSIVE BEHAVIOR
========================================================

Target desktop first.

Recommended widths:

Actions:
220-260px

Device:
260-340px

Flow:
flex / largest

Inspector:
300-360px

At smaller widths:

allow panels to collapse.

Add:

⤢ Expand Flow Builder

and optionally:

⤢ Expand Device

Do not destroy the desktop layout.

========================================================
COMPONENT ARCHITECTURE
========================================================

Adapt to existing repository conventions.

Possible structure:

MaestroBuilder/
  MaestroBuilder.tsx

  toolbar/
    MaestroToolbar.tsx

  commands/
    MaestroCommandLibrary.tsx
    MaestroCommandPicker.tsx

  device/
    MaestroDevicePreview.tsx
    ElementHighlightOverlay.tsx

  flow/
    MaestroFlowBuilder.tsx
    MaestroActionCard.tsx
    MaestroActionFields.tsx

  inspector/
    MaestroInspector.tsx
    MaestroHierarchyTree.tsx
    MaestroElementDetails.tsx
    SelectorRecommendationList.tsx

  selectors/
    MaestroSelectorEditor.tsx

  yaml/
    MaestroYamlPreview.tsx

  runner/
    MaestroRunToolbar.tsx
    MaestroRunProgress.tsx

  history/
    MaestroRunHistory.tsx

core/maestro/
  commands.ts
  types.ts
  serializer.ts
  parser.ts
  validator.ts
  hierarchy.ts
  selectorRecommendation.ts
  coordinateMapping.ts

Again:
follow existing repo architecture if different.

========================================================
STATE MANAGEMENT
========================================================

Do not put everything into one component.

Separate:

Builder State

Device State

Inspector State

Runner State

Persistence State

Reuse the project's current state-management solution.

========================================================
PERFORMANCE
========================================================

Hierarchy trees can be large.

Avoid rerendering the entire workspace on every small field edit.

Use memoization/selective subscriptions where appropriate.

Hierarchy search should remain responsive.

Do not prematurely overengineer.

========================================================
LOADING STATES
========================================================

Provide proper states.

No Device:

No device selected
Connect an Android device to inspect UI.

Maestro unavailable:

Maestro CLI not found

[ Installation Help ]

Hierarchy loading:

Reading device hierarchy...

Run:

Starting Maestro...

========================================================
ERROR HANDLING
========================================================

Explicitly handle:

- Maestro CLI missing
- incompatible Maestro version
- device disconnected
- hierarchy command failed
- malformed hierarchy
- invalid flow
- YAML serialization error
- process execution error
- flow cancelled
- output path inaccessible
- screenshot/artifact missing

No silent failures.

========================================================
REAL DATA ONLY
========================================================

VERY IMPORTANT.

Production UI must never display fake:

- hierarchy
- device properties
- command status
- run status
- artifact paths
- Maestro version

Loading/empty states are preferred over fabricated values.

========================================================
TESTING
========================================================

Add unit tests for:

Maestro serializer

- launchApp
- tapOn text
- tapOn ID
- inputText
- assertVisible
- assertNotVisible
- screenshot
- pressKey
- scrollUntilVisible
- relation selector

Validator

- missing selector
- invalid timeout
- missing input text
- invalid coordinates
- invalid latitude/longitude

Selector Recommendation

- ID > text
- unique text
- duplicate text
- index fallback
- coordinates last

Coordinate Mapping

- device → preview
- preview → device
- scale
- offsets
- rotation

Parser

- generated YAML round-trip
- supported command
- unsupported command preservation

========================================================
COMPONENT TESTS
========================================================

If the project already supports frontend/component tests:

test:

Add Action

Delete Action

Move Action

Duplicate Action

Inspect Element → Tap

Inspect Element → Assert Visible

Selector change

YAML updates

Invalid Action disables Run

========================================================
INTEGRATION TEST
========================================================

Where practical create a basic integration flow:

Launch App
    ↓
Tap known element
    ↓
Assert visible
    ↓
Screenshot

Do not make CI depend on a physical device unless the project already
supports device-based integration testing.

========================================================
IMPLEMENTATION PHASES
========================================================

PHASE 1 — FOUNDATION

- inspect repository
- inspect existing Script Manager
- inspect current Maestro implementation
- inspect ADB and device service
- inspect scrcpy system
- define Maestro data model
- command registry
- validation
- serializer
- unit tests

PHASE 2 — VISUAL BUILDER

- command library
- command picker
- action cards
- selector editor
- reorder/delete/duplicate
- YAML preview
- flow persistence

PHASE 3 — REAL MAESTRO RUNNER

- detect Maestro installation/version
- inspect actual CLI help
- backend runner
- temp YAML generation
- selected-device execution
- stdout/stderr streaming
- cancel
- run state
- error states

PHASE 4 — INSPECTOR

- real hierarchy command
- hierarchy parser
- hierarchy tree
- element details
- selector recommendations
- quick actions

PHASE 5 — DEVICE PICKER

- preview click
- coordinate translation
- bounds hit testing
- visual highlight
- bidirectional hierarchy/device selection

PHASE 6 — HISTORY & ARTIFACTS

- run persistence
- result detail
- screenshots
- recordings
- logs
- artifact discovery

PHASE 7 — POLISH

- keyboard shortcuts
- loading states
- empty states
- error states
- responsive panels
- performance cleanup
- accessibility

========================================================
AFTER EACH PHASE
========================================================

Run whatever is appropriate for this repository:

lint
typecheck
unit tests
frontend tests
backend tests
Tauri compile/check
production build

Fix errors before moving on.

Do not leave knowingly broken code.

========================================================
FINAL VERIFICATION
========================================================

The following end-to-end experience must work:

1. Start Mobile Device Studio.

2. Existing Android device appears.

3. Open:
   Testing → Script Manager → Maestro Builder.

4. Device Preview shows selected device.

5. Click Inspect.

6. Click Confirm payment on the device.

7. Inspector displays REAL metadata.

8. Recommended selector chooses the most stable selector.

9. Click:
   Tap

10. Flow Builder adds a Tap action.

11. YAML Preview immediately updates.

12. Add:
    Assert Visible

13. Save Flow.

14. Restart application.

15. Saved flow is still present.

16. Press Run.

17. Real Maestro CLI executes against selected device.

18. Flow cards show running/pass/fail state.

19. Test result is stored in Run History.

20. Real available artifacts can be opened.

========================================================
UI QUALITY TARGET
========================================================

Use the attached reference screenshot as the visual target.

The result should look like a professional desktop developer tool,
not a settings form.

Aim for visual quality similar to:

- VS Code
- Postman
- Android Studio tools
- Appium Inspector
- modern device-farm dashboards

But preserve the existing Mobile Device Studio identity.

Dense information is acceptable.

Use:
- compact controls
- subtle borders
- clear hierarchy
- status indicators
- collapsible sections

Avoid:
- giant cards
- oversized typography
- excessive empty space
- huge buttons
- mobile-style layouts on desktop
- unnecessary modals

========================================================
MOST IMPORTANT PRODUCT RULE
========================================================

Normal users should not need to write Maestro YAML.

The primary UX is:

CLICK DEVICE ELEMENT
        ↓
CHOOSE ACTION
        ↓
ACTION ADDED
        ↓
RUN

YAML is an advanced representation of the visual flow.

========================================================
DO NOT
========================================================

DO NOT:
- implement only a visual mockup
- use fake test execution
- use fake hierarchy
- hardcode WashXpress throughout generic infrastructure
- rewrite the entire application
- create one huge MaestroBuilder component
- create one custom React component per command
- duplicate existing ADB/device services
- duplicate scrcpy
- silently discard unsupported YAML
- invent Maestro flags
- expose unavailable features
- run arbitrary unescaped shell strings
- leave TypeScript errors
- leave lint failures

========================================================
FIRST RESPONSE
========================================================

Before writing code, tell me:

1. Where the current Script Manager implementation is.
2. How devices are represented.
3. How ADB commands currently run.
4. How scrcpy/device preview currently works.
5. What Maestro functionality already exists.
6. How data is currently persisted.
7. Which existing components will be reused.
8. Files/modules you plan to add/change.
9. Any limitations you discovered.
10. Exact Phase 1 implementation plan.

Then begin Phase 1.











Script Manager

[ Custom Commands ] [ Maestro Builder ] [ App Smoke ]

เมื่อเลือก:

Maestro Builder

ให้เปลี่ยน content area เป็นเต็มหน้า:

┌──────────────────────────────────────────────────────┐
│ Maestro Builder                                      │
├──────────┬──────────┬────────────────┬───────────────┤
│ Actions  │ Device   │ Flow           │ Inspector     │
│          │ Preview  │ Builder        │               │
├──────────┴──────────┴───────┬────────┴───────────────┤
│ YAML Preview                │ Run History            │
└─────────────────────────────┴────────────────────────┘

ไม่ควรบีบมันไว้แบบปัจจุบัน:

Custom Commands     │ Maestro Builder
                    │
                    │ <- แคบเกินไป

และ feature ที่ผมจะให้ Codex ให้ความสำคัญอันดับหนึ่ง คือ:

Device Preview ↔ Element Inspector ↔ Flow Builder

สามส่วนนี้ต้องเชื่อมกันจริง เช่นคลิกปุ่มในจอ:

Confirm payment

ทันทีด้านขวาขึ้น:

Button

Text
Confirm payment

ID
confirm_payment

Bounds
[72,1420][1008,1536]

Recommended
★★★★★ ID confirm_payment

แล้วกด:

[ Tap ]

ตรงกลางเพิ่ม:

6  Tap Element
   ID: confirm_payment

พร้อม YAML:

- tapOn:
    id: "confirm_payment"