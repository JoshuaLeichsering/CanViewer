import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText, downloadText } from './download';

/**
 * The tests run without a browser, so the few DOM and clipboard calls the
 * download and copy helpers make are stood in for here. The end-to-end check
 * (e2e/export-check.mjs) runs the real thing in Chromium.
 */
interface FakeElement {
  tag: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  href?: string;
  download?: string;
  value?: string;
  clicked: number;
  selected: boolean;
  removed: boolean;
  click(): void;
  select(): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
}

let created: FakeElement[];
let appended: FakeElement[];
let execCommand: ReturnType<typeof vi.fn>;

beforeEach(() => {
  created = [];
  appended = [];
  execCommand = vi.fn(() => true);
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      const element: FakeElement = {
        tag,
        style: {},
        attributes: {},
        clicked: 0,
        selected: false,
        removed: false,
        click() {
          this.clicked++;
        },
        select() {
          this.selected = true;
        },
        remove() {
          this.removed = true;
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      };
      created.push(element);
      return element;
    },
    body: { append: (element: FakeElement) => appended.push(element) },
    execCommand,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('downloadText', () => {
  it('saves the text through a Blob URL and a temporary link, and frees the URL later', async () => {
    vi.useFakeTimers();
    let blob: Blob | undefined;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b as Blob;
      return 'blob:test/1';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    downloadText('demo.messages.csv', 'text/csv;charset=utf-8', 'id,name\r\n');

    expect(create).toHaveBeenCalledTimes(1);
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    expect(await blob?.text()).toBe('id,name\r\n');
    const [link] = created;
    expect(link.tag).toBe('a');
    expect(link.href).toBe('blob:test/1');
    expect(link.download).toBe('demo.messages.csv');
    expect(link.style.display).toBe('none');
    expect(appended).toEqual([link]);
    expect(link.clicked).toBe(1);
    expect(link.removed).toBe(true);
    // The URL stays valid until the browser has surely read the Blob.
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:test/1');
  });
});

describe('copyText', () => {
  it('uses the Clipboard API where it works', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('typedef struct {} x_t;')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('typedef struct {} x_t;');
    expect(created).toEqual([]);
  });

  it('falls back to a selected text area where the Clipboard API is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    expect(await copyText('x_raw = data[0]')).toBe(true);
    const [area] = created;
    expect(area.tag).toBe('textarea');
    expect(area.value).toBe('x_raw = data[0]');
    expect(area.attributes.readonly).toBe('');
    expect(area.selected).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(area.removed).toBe(true);
  });

  it('falls back as well where there is no Clipboard API at all', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyText('text')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('resolves with false, without an error text of its own, when neither way can copy', async () => {
    vi.stubGlobal('navigator', {});
    execCommand.mockReturnValue(false);
    expect(await copyText('text')).toBe(false);
    expect(created[0].removed).toBe(true);
  });

  it('resolves with false as well when the old way throws', async () => {
    vi.stubGlobal('navigator', {});
    execCommand.mockImplementation(() => {
      throw new Error('execCommand is not supported');
    });
    expect(await copyText('text')).toBe(false);
    expect(created[0].removed).toBe(true);
  });
});
