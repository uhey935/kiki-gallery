export const restoreEditorDraftBaseline = <T>(saved: T): T =>
  structuredClone(saved);

export function commitEditorFormBaseline(form: HTMLFormElement) {
  for (const control of form.elements) {
    if (control instanceof HTMLInputElement) {
      if (control.type !== "file") control.defaultValue = control.value;
      control.defaultChecked = control.checked;
    } else if (control instanceof HTMLTextAreaElement) {
      control.defaultValue = control.value;
    } else if (control instanceof HTMLSelectElement) {
      for (const option of control.options)
        option.defaultSelected = option.selected;
    }
  }
}

export function restoreEditorFormBaseline(form: HTMLFormElement) {
  form.reset();
}
