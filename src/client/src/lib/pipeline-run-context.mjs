function cloneJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function createPipelineRunContext(source = {}) {
  const state = cloneJson(source, {});
  state.target = cloneJson(state.target, {});
  state.inputs = cloneJson(state.inputs, {});
  state.data = cloneJson(state.data, {});

  return {
    get target() {
      return state.target;
    },
    get inputs() {
      return state.inputs;
    },
    get data() {
      return state.data;
    },
    get(key, fallback = undefined) {
      return Object.prototype.hasOwnProperty.call(state.data, key) ? state.data[key] : fallback;
    },
    set(key, value) {
      state.data[key] = value;
      return value;
    },
    merge(patch = {}) {
      state.data = { ...state.data, ...cloneJson(patch, {}) };
      return state.data;
    },
    toJSON() {
      return cloneJson(state, {});
    }
  };
}

export function normalizePipelineRunContext(context = {}) {
  return createPipelineRunContext(context).toJSON();
}
