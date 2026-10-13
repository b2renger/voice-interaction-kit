// A fake cables.gl "op", just enough to run VoiceAgent.op.js outside cables (tests).
// Names and behaviour follow cables/src/core/core_op.js and core_port.js.
/* eslint-disable no-unused-vars */
function makeShimOp() {
  const ports = {};
  const uiErrors = {};
  const uiAttribs = {};

  function port(name, kind, value, extra) {
    if (ports[name]) throw new Error('duplicate port: ' + name);
    const p = {
      name, kind, value, links: 0, triggered: 0, onChange: null, onTriggered: null,
      ignoreValueSerialize: false, uiAttribs: Object.assign({}, extra || {}),
      get() { return this.value; },
      set(v) {
        if (kind === 'boolnum') v = v ? 1 : 0;
        const changed = v !== this.value;
        this.value = v;
        if (changed && this.onChange) this.onChange(this, v);
      },
      setRef(v) { this.value = v; if (this.onChange) this.onChange(this, v); },
      setValue(v) { this.set(v); },
      setUiAttribs(a) { Object.assign(this.uiAttribs, a); },
      trigger() { this.triggered++; if (this.onTriggered) this.onTriggered(); },
      isLinked() { return false; },
    };
    ports[name] = p;
    return p;
  }

  const op = {
    ports, uiErrors, uiAttribs,
    patch: {
      removed: false,
      removeOnAnimFrame() { this.removed = true; },
      isEditorMode() { return false; },
    },
    onDelete: null, onAnimFrame: null,
    // inputs
    inTrigger: (n) => port(n, 'trigger'),
    inTriggerButton: (n) => port(n, 'trigger', null, { display: 'button' }),
    inFloat: (n, v) => port(n, 'number', v === undefined ? 0 : v),
    inFloatSlider: (n, v, min, max) => port(n, 'number', v === undefined ? 0 : v, { min, max }),
    inInt: (n, v) => port(n, 'number', v === undefined ? 0 : v),
    inBool: (n, v) => port(n, 'bool', v ? 1 : 0),
    inString: (n, v) => port(n, 'string', v === undefined ? '' : v),
    inStringEditor: (n, v, syntax) => port(n, 'string', v === undefined ? '' : v, { syntax }),
    // Like cables: with the 4th argument (noindex), the default value is NOT applied;
    // without it, a hidden "<name> index" port is created and the default value is applied.
    inDropDown: (n, values, v, noindex) => {
      if (noindex) return port(n, 'string', values[0] === undefined ? '' : 0, { values });
      port(n + ' index', 'number', Math.max(0, values.indexOf(v)), { hideParam: true });
      return port(n, 'string', v === undefined ? values[0] : v, { values });
    },
    inSwitch: (n, values, v) => port(n, 'string', v === undefined ? values[0] : v, { values }),
    inObject: (n, v) => port(n, 'object', v === undefined ? null : v),
    inArray: (n, v) => port(n, 'array', v === undefined ? null : v),
    // outputs
    outTrigger: (n) => port(n, 'trigger'),
    outNumber: (n, v) => port(n, 'number', v === undefined ? 0 : v),
    outBoolNum: (n, v) => port(n, 'boolnum', v ? 1 : 0),
    outString: (n, v) => port(n, 'string', v === undefined ? '' : v),
    outObject: (n, v, objType) => port(n, 'object', v === undefined ? null : v, { objType }),
    outArray: (n, v) => port(n, 'array', v === undefined ? null : v),
    // misc
    setPortGroup() {},
    setUiError(id, txt, level) { if (txt === null || txt === undefined) delete uiErrors[id]; else uiErrors[id] = { txt, level: level === undefined ? 2 : level }; },
    setUiAttrib(a) { Object.assign(uiAttribs, a); },
    log: (...a) => console.log('[op]', ...a),
  };
  return op;
}

/** Runs an op's code the way cables does: as the body of a class constructor, in strict mode. */
function runOpCode(code) {
  const op = makeShimOp();
  // eslint-disable-next-line no-new-func
  const Cls = new Function('makeOp', '"use strict"; return class TestOp { constructor() { const op = makeOp(); this.op = op;\n' + code + '\n } };')(() => op);
  new Cls();
  let raf = 0;
  const loop = () => { if (op.onAnimFrame && !op.patch.removed) op.onAnimFrame(performance.now(), 0, 16); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  op.deleteOp = () => { cancelAnimationFrame(raf); if (op.onDelete) op.onDelete(true); };
  return op;
}
