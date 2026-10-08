// Blockly mission editor: drone and sensor blocks, code generation and a
// cooperative runner that highlights the executing block, shows variable
// values live and can be stopped at any statement. Block names follow
// Drone Commander so its saved XML programs load here unchanged.
const Blockly = window.Blockly;
const JS = Blockly.JavaScript;

const DRONE = '#ff7a1a', SENSOR = '#3fc6b4', CAMERA = '#6aa7ff', FLOW = '#95abc1';
const numIn = name => ({ type: 'input_value', name, check: 'Number' });

const BLOCKS = [
  { type: 'start_block', message0: 'when mission starts', nextStatement: null, colour: FLOW, tooltip: 'Blocks attached here run when you press Run mission.', hat: 'cap' },
  { type: 'end_block', message0: 'end mission', previousStatement: null, colour: FLOW, tooltip: 'Stop the mission here.' },
  { type: 'take_off', message0: 'take off', previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Arm the motors and climb to 5 m above the ground.' },
  { type: 'land', message0: 'land', previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Descend vertically and land where the drone is.' },
  { type: 'return_to_base', message0: 'return to home', previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Climb to at least 15 m, turn toward the vertiport and fly back above it.' },
  { type: 'set_altitude', message0: 'set altitude to %1 m', args0: [numIn('ALTITUDE')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Climb or descend to an absolute altitude in metres.' },
  { type: 'change_altitude', message0: 'change altitude by %1 m', args0: [numIn('ALTITUDE')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Climb (positive) or descend (negative).' },
  { type: 'set_angle', message0: 'turn to heading %1 °', args0: [numIn('ANGLE')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Compass heading: 0 north, 90 east, 180 south, 270 west.' },
  { type: 'change_angle', message0: 'turn by %1 °', args0: [numIn('ANGLE')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Positive turns right (clockwise), negative turns left.' },
  { type: 'walk', message0: 'fly forward %1 m', args0: [numIn('DIST')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Fly along the current heading. Negative values fly backwards.' },
  { type: 'slide', message0: 'slide right %1 m', args0: [numIn('SLIDE')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Move sideways without turning. Negative values slide left.' },
  { type: 'walk_climbing', message0: 'fly forward %1 m while climbing %2 m', args0: [numIn('DIST'), numIn('CLIMB')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Move forward and change altitude at the same time.' },
  { type: 'go_to', message0: 'go to x %1 y %2 z %3', args0: [numIn('X'), numIn('Y'), numIn('Z')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Fly straight to a map position: x east, y altitude, z north (metres from the vertiport).' },
  { type: 'move_by', message0: 'move by right %1 up %2 forward %3', args0: [numIn('X'), numIn('Y'), numIn('Z')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Move relative to where the drone is facing.' },
  { type: 'curve_abs', message0: 'curve through x %1 y %2 z %3 to x %4 y %5 z %6', args0: [numIn('X'), numIn('Y'), numIn('Z'), numIn('XD'), numIn('YD'), numIn('ZD')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Fly a circular arc through a middle map point to a destination.' },
  { type: 'curve', message0: 'curve via right %1 up %2 forward %3 then right %4 up %5 forward %6', args0: [numIn('X'), numIn('Y'), numIn('Z'), numIn('XD'), numIn('YD'), numIn('ZD')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Arc using points relative to the drone. The second point is relative to the first.' },
  { type: 'orbit_poi', message0: 'orbit point x %1 z %2 for %3 °', args0: [numIn('X'), numIn('Z'), numIn('DEG')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Circle a ground point at the current distance while the camera keeps pointing at it. The radio tower is at x 40, z 80.' },
  { type: 'wait', message0: 'hover for %1 s', args0: [numIn('DIST')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Hold position for a number of seconds.' },
  { type: 'set_speed', message0: 'set speed to %1 m/s', args0: [numIn('SPEED')], inputsInline: true, previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Cruise speed for moves, from 0.5 to 15 m/s.' },
  { type: 'smoke', message0: 'smoke trail %1', args0: [{ type: 'input_value', name: 'SMOKE', check: 'Boolean' }], previousStatement: null, nextStatement: null, colour: DRONE, tooltip: 'Draw a trail behind the drone.' },
  { type: 'take_photo', message0: 'take a photo', previousStatement: null, nextStatement: null, colour: CAMERA, tooltip: 'Capture the gimbal camera and save the picture to the logbook.' },
  { type: 'start_recording', message0: 'start video recording', previousStatement: null, nextStatement: null, colour: CAMERA, tooltip: 'Record the gimbal camera.' },
  { type: 'save_recording', message0: 'stop recording and save', previousStatement: null, nextStatement: null, colour: CAMERA, tooltip: 'Stop recording and save the video to the logbook.' },
  { type: 'log_message', message0: 'show message %1', args0: [{ type: 'input_value', name: 'TEXT' }], previousStatement: null, nextStatement: null, colour: FLOW, tooltip: 'Print a line in the mission console.' },
  { type: 'sensor_keypressed', message0: 'key %1 pressed', args0: [{ type: 'field_dropdown', name: 'KEY', options: [['↑', 'ARROW_UP'], ['↓', 'ARROW_DOWN'], ['←', 'ARROW_LEFT'], ['→', 'ARROW_RIGHT'], ['space', 'SPACE'], ['enter', 'RETURN'], ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map(c => [c, c])] }], output: 'Boolean', colour: SENSOR, tooltip: 'True while that key is held down.' },
  { type: 'sensor_gamepad', message0: 'gamepad button %1 pressed', args0: [{ type: 'field_dropdown', name: 'BTN', options: [['A / ✕', '0'], ['B / ◯', '1'], ['X / ▢', '2'], ['Y / △', '3'], ['LB / L1', '4'], ['RB / R1', '5'], ['LT / L2', '6'], ['RT / R2', '7']] }], output: 'Boolean', colour: SENSOR, tooltip: 'True while that controller button is held down.' },
  { type: 'sensor_x', message0: 'position x (east)', output: 'Number', colour: SENSOR, tooltip: 'Metres east of the vertiport.' },
  { type: 'sensor_z', message0: 'position z (north)', output: 'Number', colour: SENSOR, tooltip: 'Metres north of the vertiport.' },
  { type: 'sensor_altitude', message0: 'altitude', output: 'Number', colour: SENSOR, tooltip: 'Height in metres.' },
  { type: 'sensor_direction', message0: 'heading', output: 'Number', colour: SENSOR, tooltip: 'Compass heading in degrees.' },
  { type: 'sensor_speed', message0: 'cruise speed', output: 'Number', colour: SENSOR, tooltip: 'The speed set for moves, in m/s.' },
  { type: 'sensor_battery', message0: 'battery %', output: 'Number', colour: SENSOR, tooltip: 'Remaining battery, 0 to 100.' },
  { type: 'sensor_home', message0: 'distance to home', output: 'Number', colour: SENSOR, tooltip: 'Horizontal distance to the vertiport in metres.' }
];

const gen = {
  take_off: () => 'await drone.takeOff();\n',
  land: () => 'await drone.land();\n',
  return_to_base: () => 'await drone.returnToBase();\n',
  take_photo: () => 'await drone.takePhoto();\n',
  start_recording: () => 'await drone.startRecording();\n',
  save_recording: () => 'await drone.saveRecording();\n',
  end_block: () => 'return;\n',
  start_block: () => ''
};
const v = (b, n, d = '0') => JS.valueToCode(b, n, JS.ORDER_NONE) || d;
Object.assign(gen, {
  set_altitude: b => `await drone.setAltitude(${v(b, 'ALTITUDE')});\n`,
  change_altitude: b => `await drone.changeAltitude(${v(b, 'ALTITUDE')});\n`,
  set_angle: b => `await drone.setAngle(${v(b, 'ANGLE')});\n`,
  change_angle: b => `await drone.changeAngle(${v(b, 'ANGLE')});\n`,
  walk: b => `await drone.walk(${v(b, 'DIST')});\n`,
  slide: b => `await drone.slide(${v(b, 'SLIDE')});\n`,
  walk_climbing: b => `await drone.walkClimbing(${v(b, 'DIST')}, ${v(b, 'CLIMB')});\n`,
  go_to: b => `await drone.goTo(${v(b, 'X')}, ${v(b, 'Y', '10')}, ${v(b, 'Z')});\n`,
  move_by: b => `await drone.moveBy(${v(b, 'X')}, ${v(b, 'Y')}, ${v(b, 'Z')});\n`,
  curve_abs: b => `await drone.curveAbs(${['X', 'Y', 'Z', 'XD', 'YD', 'ZD'].map(n => v(b, n)).join(', ')});\n`,
  curve: b => `await drone.curve(${['X', 'Y', 'Z', 'XD', 'YD', 'ZD'].map(n => v(b, n)).join(', ')});\n`,
  orbit_poi: b => `await drone.orbitPoi(${v(b, 'X')}, ${v(b, 'Z')}, ${v(b, 'DEG', '360')});\n`,
  wait: b => `await drone.wait(${v(b, 'DIST')});\n`,
  set_speed: b => `drone.speed = ${v(b, 'SPEED', '3')};\n`,
  smoke: b => `drone.smoke = !!(${v(b, 'SMOKE', 'false')});\n`,
  log_message: b => `__log(${v(b, 'TEXT', "''")});\n`,
  sensor_keypressed: b => [`__key('${b.getFieldValue('KEY')}')`, JS.ORDER_FUNCTION_CALL],
  sensor_gamepad: b => [`__pad(${Number(b.getFieldValue('BTN'))})`, JS.ORDER_FUNCTION_CALL],
  sensor_x: () => ['drone.x', JS.ORDER_MEMBER],
  sensor_z: () => ['drone.z', JS.ORDER_MEMBER],
  sensor_altitude: () => ['drone.altitude', JS.ORDER_MEMBER],
  sensor_direction: () => ['drone.direction', JS.ORDER_MEMBER],
  sensor_speed: () => ['drone.speed', JS.ORDER_MEMBER],
  sensor_battery: () => ['drone.battery', JS.ORDER_MEMBER],
  sensor_home: () => ['drone.distanceHome', JS.ORDER_MEMBER]
});

let defined = false;
function defineBlocks() {
  if (defined) return;
  defined = true;
  BLOCKS.forEach(b => { delete Blockly.Blocks[b.type]; });
  Blockly.defineBlocksWithJsonArray(BLOCKS);
  Object.entries(gen).forEach(([k, fn]) => { JS.forBlock[k] = fn; });
  // user functions take part in the asynchronous flight sequence
  const callRet = JS.forBlock.procedures_callreturn;
  JS.forBlock.procedures_callnoreturn = (b, g) => `await ${callRet(b, g)[0]};\n`;
  JS.forBlock.procedures_callreturn = (b, g) => [`(await ${callRet(b, g)[0]})`, JS.ORDER_NONE];
  JS.forBlock.math_random_int = (b, g) => {
    const from = g.valueToCode(b, 'FROM', JS.ORDER_NONE) || '0', to = g.valueToCode(b, 'TO', JS.ORDER_NONE) || '0';
    return [`Math.floor(Math.random() * ((${to}) - (${from}) + 1) + (${from}))`, JS.ORDER_FUNCTION_CALL];
  };
  JS.addReservedWords('drone,__tick,__log,__key,__pad');
}

const shadowNum = n => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const shadowText = t => ({ shadow: { type: 'text', fields: { TEXT: t } } });
const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Flight', colour: DRONE, contents: [
      { kind: 'block', type: 'take_off' }, { kind: 'block', type: 'land' }, { kind: 'block', type: 'return_to_base' },
      { kind: 'block', type: 'set_speed', inputs: { SPEED: shadowNum(4) } },
      { kind: 'block', type: 'walk', inputs: { DIST: shadowNum(10) } },
      { kind: 'block', type: 'slide', inputs: { SLIDE: shadowNum(5) } },
      { kind: 'block', type: 'change_angle', inputs: { ANGLE: shadowNum(90) } },
      { kind: 'block', type: 'set_angle', inputs: { ANGLE: shadowNum(0) } },
      { kind: 'block', type: 'set_altitude', inputs: { ALTITUDE: shadowNum(15) } },
      { kind: 'block', type: 'change_altitude', inputs: { ALTITUDE: shadowNum(5) } },
      { kind: 'block', type: 'walk_climbing', inputs: { DIST: shadowNum(10), CLIMB: shadowNum(3) } },
      { kind: 'block', type: 'go_to', inputs: { X: shadowNum(0), Y: shadowNum(20), Z: shadowNum(40) } },
      { kind: 'block', type: 'move_by', inputs: { X: shadowNum(0), Y: shadowNum(0), Z: shadowNum(10) } },
      { kind: 'block', type: 'curve_abs', inputs: { X: shadowNum(20), Y: shadowNum(15), Z: shadowNum(20), XD: shadowNum(0), YD: shadowNum(15), ZD: shadowNum(40) } },
      { kind: 'block', type: 'curve', inputs: { X: shadowNum(10), Y: shadowNum(0), Z: shadowNum(10), XD: shadowNum(-10), YD: shadowNum(0), ZD: shadowNum(10) } },
      { kind: 'block', type: 'orbit_poi', inputs: { X: shadowNum(40), Z: shadowNum(80), DEG: shadowNum(360) } },
      { kind: 'block', type: 'wait', inputs: { DIST: shadowNum(2) } },
      { kind: 'block', type: 'smoke', inputs: { SMOKE: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } } }
    ] },
    { kind: 'category', name: 'Camera', colour: CAMERA, contents: [
      { kind: 'block', type: 'take_photo' }, { kind: 'block', type: 'start_recording' }, { kind: 'block', type: 'save_recording' }
    ] },
    { kind: 'category', name: 'Sensors', colour: SENSOR, contents: [
      { kind: 'block', type: 'sensor_keypressed' }, { kind: 'block', type: 'sensor_gamepad' },
      { kind: 'block', type: 'sensor_x' }, { kind: 'block', type: 'sensor_z' }, { kind: 'block', type: 'sensor_altitude' },
      { kind: 'block', type: 'sensor_direction' }, { kind: 'block', type: 'sensor_speed' }, { kind: 'block', type: 'sensor_battery' }, { kind: 'block', type: 'sensor_home' }
    ] },
    { kind: 'sep' },
    { kind: 'category', name: 'Logic', categorystyle: 'logic_category', contents: ['controls_if', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean', 'logic_ternary'].map(type => ({ kind: 'block', type })) },
    { kind: 'category', name: 'Loops', categorystyle: 'loop_category', contents: [
      { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: shadowNum(4) } },
      { kind: 'block', type: 'controls_whileUntil' },
      { kind: 'block', type: 'controls_for', inputs: { FROM: shadowNum(1), TO: shadowNum(5), BY: shadowNum(1) } },
      { kind: 'block', type: 'controls_forEach' }, { kind: 'block', type: 'controls_flow_statements' }] },
    { kind: 'category', name: 'Math', categorystyle: 'math_category', contents: [
      { kind: 'block', type: 'math_number' }, { kind: 'block', type: 'math_arithmetic' }, { kind: 'block', type: 'math_single' },
      { kind: 'block', type: 'math_trig' }, { kind: 'block', type: 'math_round' }, { kind: 'block', type: 'math_modulo' },
      { kind: 'block', type: 'math_constrain' }, { kind: 'block', type: 'math_random_int', inputs: { FROM: shadowNum(1), TO: shadowNum(10) } }] },
    { kind: 'category', name: 'Text', categorystyle: 'text_category', contents: [{ kind: 'block', type: 'text' }, { kind: 'block', type: 'text_join' }] },
    { kind: 'category', name: 'Lists', categorystyle: 'list_category', contents: ['lists_create_with', 'lists_length', 'lists_getIndex', 'lists_setIndex'].map(type => ({ kind: 'block', type })) },
    { kind: 'category', name: 'Variables', categorystyle: 'variable_category', custom: 'VARIABLE' },
    { kind: 'category', name: 'Functions', categorystyle: 'procedure_category', custom: 'PROCEDURE' },
    { kind: 'category', name: 'Flow', colour: FLOW, contents: [{ kind: 'block', type: 'start_block' }, { kind: 'block', type: 'end_block' }, { kind: 'block', type: 'log_message', inputs: { TEXT: shadowText('Hello from the drone') } }] }
  ]
};

const theme = () => Blockly.Theme.defineTheme('aerotwin', {
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: '#13253a', toolboxBackgroundColour: '#0f1d2c', toolboxForegroundColour: '#e7eef5',
    flyoutBackgroundColour: '#172c42', flyoutForegroundColour: '#e7eef5', flyoutOpacity: 0.97,
    scrollbarColour: '#2a4661', insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3, cursorColour: '#ff7a1a'
  },
  fontStyle: { family: 'Archivo, system-ui, sans-serif', size: 12 }
});

export const EMPTY_MISSION = '<xml xmlns="https://developers.google.com/blockly/xml"><block type="start_block" x="24" y="24"></block></xml>';

export class MissionEditor {
  constructor(div, { onChange } = {}) {
    defineBlocks();
    this.ws = Blockly.inject(div, {
      toolbox: TOOLBOX, renderer: 'zelos', theme: theme(), trashcan: false,
      zoom: { controls: false, wheel: true, startScale: 0.72, maxScale: 1.6, minScale: 0.35, scaleSpeed: 1.15, pinch: true },
      grid: { spacing: 24, length: 2, colour: '#223b54', snap: true },
      move: { scrollbars: true, drag: true, wheel: false }
    });
    this.ws.addChangeListener(Blockly.Events.disableOrphans);
    this.ws.addChangeListener(e => { if (!e.isUiEvent) onChange?.(); });
    this.running = false;
  }

  load(xmlText) {
    this.ws.clear();
    const dom = Blockly.utils.xml.textToDom(xmlText);
    Blockly.Xml.domToWorkspace(dom, this.ws);
    this.ws.scrollCenter();
  }
  xml() { return Blockly.Xml.domToPrettyText(Blockly.Xml.workspaceToDom(this.ws)); }
  resize() { Blockly.svgResize(this.ws); }
  usesManualSensors() { return this.ws.getAllBlocks(false).some(b => b.type === 'sensor_keypressed' || b.type === 'sensor_gamepad'); }

  /** Compile the workspace into an async function body. */
  compile() {
    JS.init(this.ws);
    const vars = this.ws.getAllVariables().map(m => ({ name: m.name, code: JS.nameDB_.getName(m.getId(), Blockly.Names.NameType.VARIABLE) }));
    const procs = Blockly.Procedures.allProcedures(this.ws).flat().map(p => JS.nameDB_.getName(p[0], Blockly.Names.NameType.PROCEDURE));
    JS.finish('');
    const snap = vars.map(x => `${JSON.stringify(x.name)}: (typeof ${x.code} === 'undefined' ? undefined : ${x.code})`).join(', ');
    JS.STATEMENT_PREFIX = `await __tick(%1, () => ({${snap}}));\n`;
    JS.INFINITE_LOOP_TRAP = 'await __tick(null);\n';
    let code;
    try { code = JS.workspaceToCode(this.ws); }
    finally { JS.STATEMENT_PREFIX = null; JS.INFINITE_LOOP_TRAP = null; }
    for (const p of procs) code = code.replace(new RegExp(`\\bfunction ${p}\\(`, 'g'), `async function ${p}(`);
    return code;
  }

  /** Run the mission against an autopilot. Resolves when it ends or is stopped. */
  async run(drone, { log, key, pad, onVars }) {
    if (this.running) return;
    const hasStart = this.ws.getTopBlocks(false).some(b => b.type === 'start_block');
    if (!hasStart) { log('Add a "when mission starts" block and attach the flight blocks under it.', 'warn'); return 'empty'; }
    const code = this.compile();
    this.running = true;
    this.stopFlag = false;
    let lastYield = performance.now();
    const tick = async (id, vars) => {
      if (this.stopFlag) throw new (await import('./autopilot.js')).Cancelled();
      if (id) this.ws.highlightBlock(id);
      if (vars) onVars?.(vars());
      if (performance.now() - lastYield > 14) { await new Promise(r => requestAnimationFrame(r)); lastYield = performance.now(); }
      else await null;
      if (this.stopFlag) throw new (await import('./autopilot.js')).Cancelled();
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let result = 'done';
    try {
      const fn = new AsyncFunction('drone', '__tick', '__log', '__key', '__pad', code);
      await fn(drone, tick, t => log(String(t)), key, pad);
    } catch (e) {
      if (e.name === 'Cancelled') result = 'stopped';
      else { result = 'error'; log(`Mission error: ${e.message}`, 'error'); console.error(e, code); }
    } finally {
      this.running = false;
      this.ws.highlightBlock(null);
    }
    return result;
  }
  stop() { this.stopFlag = true; }
}
