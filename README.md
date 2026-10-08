# AeroTwin: browser drone simulator

AeroTwin is a quadcopter flight simulator that runs entirely in the browser.
You can fly it three ways:

1. **Keyboard**, using a Mode 2 transmitter layout (neither source project supported this).
2. **Gamepad**, with any Xbox, PlayStation or generic controller.
3. **Block missions**, which you build in Blockly with loops, variables, functions and sensors.

Every flight is recorded to a local logbook so you can replay it in 3D later.

**Live site:** _add your CloudFront URL here after deploying_

## Features

- **Flight model.** Angle-mode physics where tilt drives acceleration, plus linear drag, climb-rate control, a draining battery, sport mode, optional wind gusts, rooftop landings, bumps and crashes.
- **Keyboard (Mode 2).** W/S throttle, A/D yaw, arrow keys pitch and roll. Keys ramp smoothly instead of snapping to full deflection. Mode 1 is available.
- **Gamepad.** Uses the Web Gamepad API, with adjustable dead zone and expo, inverted pitch, and button actions (take off/land, return to home, camera, photo, smoke, record).
- **Touch.** Phones and tablets get on-screen thumb sticks.
- **Block missions.** Take off, land, fly forward, slide, climb, go to, move by, arc curves, point-of-interest orbit, hover, speed and smoke blocks; camera blocks; sensor blocks for keys, gamepad buttons, position, heading, battery and distance to home.
  - The block currently running is highlighted, and variables update live.
  - Moving any stick hands control back to the pilot.
  - Obstacle detection triggers an emergency landing.
- **World.** A vertiport, a city district with a rooftop pad, a park, a radio tower, a lake, and an eight-gate ring course with lap timing. Day, dusk and night lighting, plus a drone headlight.
- **Cameras.** Chase, FPV, orbit and top-down views, plus a stabilised gimbal camera shown picture-in-picture. Photos (PNG) and video (WebM) can be captured from it.
- **HUD.** Altitude, vertical speed, ground speed, a compass tape with a home marker, battery, flight timer, distance to home, a mini-map, live stick positions and an input graph.
- **Logbook.** Records telemetry at 10 Hz. Each flight gets a top-down track, an altitude and speed chart, and an event list, and can be replayed as a ghost drone with scrubbing. The logbook also holds a photo/video gallery and versioned missions, and can export everything.

## Run locally

The site is plain static files, with no build step. Serve the folder over HTTP, because ES modules don't load from `file://`:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

On Windows you can also use VS Code's *Live Server* extension.

## Host on AWS

The site is meant to be hosted as static files in a private **S3** bucket behind **CloudFront**, created with the included CloudFormation template:

```bash
aws cloudformation deploy --stack-name aerotwin-site \
  --template-file deploy/cloudformation.yaml \
  --parameter-overrides BucketName=aerotwin-site-<yourname> --region ap-south-1
./deploy/deploy.sh aerotwin-site-<yourname> <DistributionId>
```

See [docs/DEPLOY_AWS.md](docs/DEPLOY_AWS.md) for the full walkthrough, a console-only route, GitHub Actions, costs and teardown.

## Project structure

```
index.html           landing page with a live 3D hero and the controls table
sim.html             the simulator (3D view, HUD, mission editor, flight data drawer)
logbook.html         flights, replays, photos/videos and missions
404.html             error page used by CloudFront
assets/
  css/               base tokens, page components, simulator HUD, landing
  js/core/           storage (IndexedDB logbook), UI helpers, sample missions
  js/sim/            world, drone model, flight physics, input, autopilot,
                     Blockly missions, recorder, audio, main loop
  js/landing.js      hero scene
  js/logbook.js      logbook page
  vendor/            three.js r124, Google Blockly 10
deploy/              CloudFormation template and deploy scripts (bash + PowerShell)
                     (deploy/github-actions-deploy.yml: optional CI, copy to .github/workflows/)
```

## Coordinates used by missions

`x` is metres east of the vertiport, `z` is metres north, `y` is altitude.
Headings are compass degrees: 0 is north, 90 is east. The radio tower stands at x 40, z 80.

## Credits

AeroTwin was built by Mudit (VIT Chennai). It reuses ideas and code from two MIT-licensed projects:

- [Drone Commander](https://github.com/vroby65/DroneCommander) by vroby65: the Blockly command set, block names (its saved programs import directly), the command-queue design and the circular-arc Bézier maths.
- [Drone Simulator](https://github.com/MSubham06/Drone_Simulator) by Subham: Mode 2 gamepad mapping, input smoothing, the procedural motor sound and the input graph.

It also uses [three.js](https://threejs.org) (MIT), [Google Blockly](https://developers.google.com/blockly) (Apache 2.0), and the Archivo and B612 Mono fonts (SIL OFL).
