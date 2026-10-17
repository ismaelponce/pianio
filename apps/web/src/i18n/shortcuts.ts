export function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, button, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-score-scroll]');
}
