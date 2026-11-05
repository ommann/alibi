import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, input, output, signal } from '@angular/core';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('json', json);

@Component({
  selector: 'app-json-editor',
  templateUrl: './json-editor.html',
  styleUrl: './json-editor.css',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonEditor {
  readonly value = input.required<string>();
  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly save = output<string>();
  readonly draft = signal('');
  readonly highlighted = computed(() => hljs.highlight(this.draft() + '\n', { language: 'json' }).value);
  readonly error = computed(() => {
    try {
      JSON.parse(this.draft());
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

  constructor() {
    effect(() => this.draft.set(this.value()));
  }

  edit(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  commit(): void {
    if (!this.error() && this.draft() !== this.value()) this.save.emit(this.draft());
  }
}
