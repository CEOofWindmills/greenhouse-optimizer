// Lightweight entity system — selectable/draggable objects on the canvas
// Type handlers are registered per entity type (e.g., 'tree-grid')

const entities = [];
const typeHandlers = {};
let selectedEntity = null;

export function registerEntityType(type, handlers) {
  typeHandlers[type] = handlers;
}

export function addEntity(entity) {
  entities.push(entity);
}

export function getEntities() { return entities; }
export function getSelected() { return selectedEntity; }
export function getTypeHandler(type) { return typeHandlers[type]; }

export function hitTestAll(mx, my, params) {
  // Iterate in reverse so topmost entities are tested first
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    const handler = typeHandlers[e.type];
    if (handler && handler.hitTest(e, mx, my, params)) {
      return e;
    }
  }
  return null;
}

export function selectEntity(entity) {
  if (selectedEntity && selectedEntity !== entity) {
    selectedEntity.selected = false;
  }
  selectedEntity = entity;
  if (entity) entity.selected = true;
}

export function deselectAll() {
  if (selectedEntity) {
    selectedEntity.selected = false;
    selectedEntity.dragging = false;
  }
  selectedEntity = null;
}
