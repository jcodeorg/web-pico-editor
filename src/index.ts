/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Terminal} from 'xterm';
import {FitAddon} from 'xterm-addon-fit';
import {WebLinksAddon} from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import {
  serial as polyfill, SerialPort as SerialPortPolyfill,
} from 'web-serial-polyfill';
import * as monaco from 'monaco-editor';

// Monaco Editorの初期化
document.addEventListener('DOMContentLoaded', () => {
  const editor =
    monaco.editor.create(document.getElementById('editor') as HTMLElement, {
      value: '',
      language: 'python',
      theme: 'vs-dark',
    });

  // Load main.pyボタンのクリックイベント
  const loadFileButton =
    document.getElementById('loadFileButton') as HTMLButtonElement;
  loadFileButton.addEventListener('click', async () => {
    await loadTempPy(editor);
  });

  // Send Textボタンのクリックイベント
  const saveFileButton =
    document.getElementById('saveFileButton') as HTMLButtonElement;
  saveFileButton.addEventListener('click', async () => {
    const text = editor.getValue();
    await pico.writeFile('temp.py', text); // エディタの内容をファイルに書き込む
  });

  // run Code ボタンのクリックイベント
  const runCodeButton =
    document.getElementById('runCodeButton') as HTMLButtonElement;
  runCodeButton.addEventListener('click', async () => {
    const text = editor.getValue();
    await pico.runCode(text); // 実行
  });

  // STOPボタン：CTRL-C を送信
  const stopButton =
    document.getElementById('stopButton') as HTMLButtonElement;
  stopButton.addEventListener('click', ()=> {
    pico.sendCommand('\x03'); // CTRL+C
  });
});

/**
 * Load main.py from the MicroPython device and display it in the editor.
 *
 * @param {monaco.editor.IStandaloneCodeEditor} editor
 *  - The Monaco editor instance.
 */
async function loadTempPy(editor: monaco.editor.IStandaloneCodeEditor) {
  if (picoreader) {
    await picoreader.cancel(); // ターミナル出力を停止
  }
  if (pico.prepareWritablePort()) {
    await pico.write('\x01'); // CTRL+A：raw モード
    await pico.write('import os\r');
    await pico.write('with open("temp.py") as f:\r');
    await pico.write('  print(f.read())\r');
    await pico.write('\x04'); // CTRL+D
    pico.releaseLock();

    await pico.clearpicoport('OK'); // ">OK"を待つ
    const result = await pico.clearpicoport('\x04'); // CTRL-Dを待つ

    // ファイル内容を表示
    console.log('result:', result);
    const hexResult = Array.from(result, (char) =>
      char.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    console.log('dump:', hexResult);

    pico.sendCommand('\x02'); // CTRL+B
    editor.setValue(result); // エディタに結果を表示
  }
  pico.readpicoport(); // ターミナル出力を再開
}

/**
 * Elements of the port selection dropdown extend HTMLOptionElement so that
 * they can reference the SerialPort they represent.
 */
declare class PortOption extends HTMLOptionElement {
  port: SerialPort | SerialPortPolyfill;
}

let portSelector: HTMLSelectElement;
let connectButton: HTMLButtonElement;
const autoconnect = false;

let portCounter = 1;
let picoport: SerialPort | SerialPortPolyfill | undefined;
let picoreader:
  ReadableStreamDefaultReader | ReadableStreamBYOBReader | undefined;

const urlParams = new URLSearchParams(window.location.search);
const usePolyfill = urlParams.has('polyfill');

const term = new Terminal({
  scrollback: 10_000,
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

term.loadAddon(new WebLinksAddon());

const encoder = new TextEncoder();

term.onData((data) => {
  // echoCheckbox.checked
  //   term.write(data);

  if (picoport?.writable == null) {
    console.warn(`unable to find writable port`);
    return;
  }

  const writer = picoport.writable.getWriter();
  writer.write(encoder.encode(data));
  writer.releaseLock();
});

/**
 * Returns the option corresponding to the given SerialPort if one is present
 * in the selection dropdown.
 *
 * @param {SerialPort} port the port to find
 * @return {PortOption}
 */
function findPortOption(port: SerialPort | SerialPortPolyfill):
    PortOption | null {
  for (let i = 0; i < portSelector.options.length; ++i) {
    const option = portSelector.options[i];
    if (option.value === 'prompt') {
      continue;
    }
    const portOption = option as PortOption;
    if (portOption.port === port) {
      return portOption;
    }
  }

  return null;
}

/**
 * Adds the given port to the selection dropdown.
 *
 * @param {SerialPort} port the port to add
 * @return {PortOption}
 */
function addNewPort(port: SerialPort | SerialPortPolyfill): PortOption {
  const portOption = document.createElement('option') as PortOption;
  portOption.textContent = `Port ${portCounter++}`;
  portOption.port = port;
  portSelector.appendChild(portOption);
  return portOption;
}

/**
 * Adds the given port to the selection dropdown, or returns the existing
 * option if one already exists.
 *
 * @param {SerialPort} port the port to add
 * @return {PortOption}
 */
function maybeAddNewPort(port: SerialPort | SerialPortPolyfill): PortOption {
  const portOption = findPortOption(port);
  if (portOption) {
    return portOption;
  }

  return addNewPort(port);
}

/**
 * Download the terminal's contents to a file.
 */
function downloadTerminalContents(): void {
  if (!term) {
    throw new Error('no terminal instance found');
  }

  if (term.rows === 0) {
    console.log('No output yet');
    return;
  }

  term.selectAll();
  const contents = term.getSelection();
  term.clearSelection();
  const linkContent = URL.createObjectURL(
      new Blob([new TextEncoder().encode(contents).buffer],
          {type: 'text/plain'}));
  const fauxLink = document.createElement('a');
  fauxLink.download = `terminal_content_${new Date().getTime()}.txt`;
  fauxLink.href = linkContent;
  fauxLink.click();
}

/**
 * Clear the terminal's contents.
 */
function clearTerminalContents(): void {
  if (!term) {
    throw new Error('no terminal instance found');
  }

  if (term.rows === 0) {
    console.log('No output yet');
    return;
  }

  term.clear();
}

/**
 * Sets |port| to the currently selected port. If none is selected then the
 * user is prompted for one.
 */
async function getSelectedPort(): Promise<void> {
  if (portSelector.value == 'prompt') {
    try {
      const serial = usePolyfill ? polyfill : navigator.serial;
      picoport = await serial.requestPort({});
    } catch (e) {
      return;
    }
    const portOption = maybeAddNewPort(picoport);
    portOption.selected = true;
  } else {
    const selectedOption = portSelector.selectedOptions[0] as PortOption;
    picoport = selectedOption.port;
  }
}

/**
 * Class representing a Pico device.
 */
class Pico {
  private writer: WritableStreamDefaultWriter | null = null;

  /**
   * Prepare the writable port.
   * @return {WritableStreamDefaultWriter | null}
   * The writer instance or null if not available.
   */
  prepareWritablePort() {
    if (picoport && picoport.writable) {
      this.writer = picoport.writable.getWriter();
    } else {
      this.writer = null;
    }
    return this.writer;
  }

  /**
   * Release the writer lock.
   */
  releaseLock() {
    if (this.writer) {
      this.writer.releaseLock();
    }
  }

  /**
   * Write a string to the writer.
   * @param {string} s - The string to write.
   * @throws {Error} If the writer is not available.
   */
  async write(s: string) {
    if (this.writer) {
      await this.writer.write(new TextEncoder().encode(s));
    } else {
      throw new Error('Writer is not available');
    }
  }

  /**
   * Write a file to the MicroPython device.
   * @param {string} filename - The name of the file.
   * @param {string} content - The content to write to the file.
   */
  async writeFile(filename: string, content: string) {
    if (picoreader) {
      await picoreader.cancel(); // ターミナル出力を停止
    }
    this.clearpicoport(false); // ターミナル出力せずに読み込み（バッファをクリア）
    if (this.prepareWritablePort()) {
      const lines = content.split('\n');
      await this.write('\x01'); // CTRL+A
      await this.write(`with open("${filename}", "w") as f:\r`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let sanitizedLine = line.replace(/[\r\n]+$/, '');
        if (i === lines.length - 1) {
          if (sanitizedLine) {
            await this.write(`  f.write(${JSON.stringify(sanitizedLine)})`);
          }
        } else {
          sanitizedLine += '\n';
          await this.write(`  f.write(${JSON.stringify(sanitizedLine)})\r`);
        }
      }
      await this.write('\x04'); // CTRL+D
      this.releaseLock();
      pico.sendCommand('\x02'); // CTRL+B
    }
    if (picoreader) {
      await picoreader.cancel(); // ターミナル出力を停止
    }
    this.readpicoport(); // ターミナル出力を再開
  }

  /**
   * Run code on the MicroPython device.
   * @param {string} content - The content to write to the file.
   */
  async runCode(content: string) {
    if (this.prepareWritablePort()) {
      await this.write('\x01'); // CTRL+A
      await this.write(content);
      await this.write('\x04'); // CTRL+D
      await this.write('\x02'); // CTRL+B
      this.releaseLock();
    }
  }

  /**
   * Send command to the Pico device.
   *
   * @param {string} command - The command to send.
   */
  async sendCommand(command: string) {
    if (this.prepareWritablePort()) {
      await this.write(command);
      this.releaseLock();
    }
  }

  /**
   * Resets the UI back to the disconnected state.
   */
  public markDisconnected(): void {
    term.writeln('<DISCONNECTED>');
    portSelector.disabled = false;
    connectButton.textContent = 'Connect';
    connectButton.disabled = false;
    connectButton.classList.add('button-default');
    picoport = undefined;
  }

  /**
   * Open the port.
   */
  async openpicoport(): Promise<void> {
    await getSelectedPort();
    if (!picoport) {
      return;
    }
    const options = {
      baudRate: 115200,
    };
    portSelector.disabled = true;
    connectButton.textContent = 'Connecting...';
    connectButton.classList.remove('button-default');
    try {
      await picoport.open(options);
      term.writeln('<CONNECTED>');
      connectButton.textContent = 'Disconnect';
      connectButton.disabled = false;
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        term.writeln(`<ERROR: ${e.message}>`);
      }
      this.markDisconnected();
      return;
    }
  }
  /**
   * Close the port.
   */
  async closepicoport(): Promise<void> {
    if (picoport) {
      try {
        await picoport.close();
      } catch (e) {
        console.error(e);
        if (e instanceof Error) {
          term.writeln(`<ERROR: ${e.message}>`);
        }
      }
      this.markDisconnected();
    }
  }

  /**
   * 読み込みバッファをクリアし、特定の文字を待ち、それまでに受信した文字を返す
   * @param {string | false} targetChar
   *  - 待機する特定の文字、またはチェックを無効にするためのfalse
   * @return {Promise<string>} - 受信した文字列を返すプロミス
   */
  async clearpicoport(targetChar: string | false): Promise<string> {
    let result = '';
    if (picoport && picoport.readable) {
      picoreader = picoport.readable.getReader();
      const generator = readFromPort(targetChar);
      if (picoreader) {
        try {
          for await (const chunk of generator) {
            if (targetChar && chunk.includes(targetChar)) {
              // 特定の文字が含まれている部分を除外
              const [beforeTarget] = chunk.split(targetChar);
              result += beforeTarget;
              break;
            } else {
              result += chunk;
            }
            console.log('Result:', chunk);
          }
        } catch (e) {
          console.error(e);
          await new Promise<void>((resolve) => {
            if (e instanceof Error) {
              term.writeln(`<ERROR: ${e.message}>`, resolve);
            }
          });
        } finally {
          picoreader.releaseLock();
          picoreader = undefined;
        }
      }
    }
    return result;
  }
  /**
   * Initiates a connection to the selected port.
   */
  async connectToPort(): Promise<void> {
    await this.openpicoport(); // ポートを開く
    await this.readpicoport(); // ポートから読み取りターミナルに出力
    // await this.closepicoport();
  }
  /**
   * read the port.
   */
  async readpicoport(): Promise<void> {
    if (picoport && picoport.readable) {
      picoreader = picoport.readable.getReader();
      const generator = readFromPort(false);
      if (picoreader) {
        try {
          for await (const chunk of generator) {
            console.log('Received:', chunk);
            // ターミナルに出力
            await new Promise<void>((resolve) => {
              term.write(chunk, resolve);
            });
          }
        } catch (e) {
          console.error(e);
          await new Promise<void>((resolve) => {
            if (e instanceof Error) {
              term.writeln(`<ERROR: ${e.message}>`, resolve);
            }
          });
        } finally {
          picoreader.releaseLock();
          picoreader = undefined;
        }
      }
    }
  }
}

/**
 * シリアルポートからデータを読み取るジェネレーター関数
 * @param {string | false} targetChar
 *  - 待機する特定の文字
 * @return {AsyncGenerator<string>}
 *  - データチャンクを文字列として返す非同期ジェネレーター
 */
async function* readFromPort(
    targetChar: string | false): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  if (picoreader) {
    while (true) {
      const {value, done} = await picoreader.read();
      if (done) {
        console.log('done:');
        return;
      }
      const chunk = decoder.decode(value, {stream: true});
      console.log('yield:', chunk);
      yield chunk;
      // targetChar が false でない場合にのみチェック
      if (targetChar && chunk.includes(targetChar)) {
        console.log('targetChar:', chunk);
        return;
      }
    }
  }
}

// Pico クラスのインスタンスを作成
const pico = new Pico();

/**
 * Closes the currently active connection.
 */
async function disconnectFromPort(): Promise<void> {
  // Move |port| into a local variable so that connectToPort() doesn't try to
  // close it on exit.
  const localPort = picoport;
  picoport = undefined;

  if (picoreader) {
    await picoreader.cancel();
  }

  if (localPort) {
    try {
      await localPort.close();
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        term.writeln(`<ERROR: ${e.message}>`);
      }
    }
  }

  pico.markDisconnected();
}

document.addEventListener('DOMContentLoaded', async () => {
  const terminalElement = document.getElementById('terminal');
  if (terminalElement) {
    term.open(terminalElement);
    fitAddon.fit();

    window.addEventListener('resize', () => {
      fitAddon.fit();
    });
  }

  const downloadOutput =
    document.getElementById('download') as HTMLSelectElement;
  downloadOutput.addEventListener('click', downloadTerminalContents);

  const clearOutput = document.getElementById('clear') as HTMLSelectElement;
  clearOutput.addEventListener('click', clearTerminalContents);

  portSelector = document.getElementById('ports') as HTMLSelectElement;

  connectButton = document.getElementById('connect') as HTMLButtonElement;
  connectButton.addEventListener('click', () => {
    if (picoport) {
      disconnectFromPort();
    } else {
      pico.connectToPort();
    }
  });


  const serial = usePolyfill ? polyfill : navigator.serial;
  const ports: (SerialPort | SerialPortPolyfill)[] = await serial.getPorts();
  ports.forEach((port) => addNewPort(port));

  // These events are not supported by the polyfill.
  // https://github.com/google/web-serial-polyfill/issues/20
  if (!usePolyfill) {
    navigator.serial.addEventListener('connect', (event) => {
      const portOption = addNewPort(event.target as SerialPort);
      if (autoconnect) {
        portOption.selected = true;
        pico.connectToPort();
      }
    });
    navigator.serial.addEventListener('disconnect', (event) => {
      const portOption = findPortOption(event.target as SerialPort);
      if (portOption) {
        portOption.remove();
      }
    });
  }
});
