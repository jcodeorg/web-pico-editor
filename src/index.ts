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
 * REPL用ターミナル
 */
class ReplTerminal extends Terminal {
  public fitAddon: FitAddon;
  /**
   * REPL用ターミナルのコンストラクタ
   * @param {any} options - ターミナルのオプション
   * @param {FitAddon} fitAddon - FitAddonインスタンス
   */
  constructor(options: any, fitAddon: FitAddon) {
    // 親クラスのコンストラクタを呼び出す
    super(options);
    this.fitAddon = fitAddon;
    this.loadAddon(this.fitAddon);
    this.loadAddon(new WebLinksAddon());

    this.onData((data)=>{
      // echoCheckbox.checked
      //   term.write(data);
      const encoder = new TextEncoder();
      if (picoserial.picoport?.writable == null) {
        console.warn(`unable to find writable port`);
        return;
      }
      const writer = picoserial.picoport.writable.getWriter();
      writer.write(encoder.encode(data));
      writer.releaseLock();
    });
  }
}

// Term クラスのインスタンスを作成
const term = new ReplTerminal(
    {scrollback: 10_000},
    new FitAddon(),
);

document.addEventListener('DOMContentLoaded', async () => {
  const terminalElement = document.getElementById('terminal');
  if (terminalElement) {
    term.open(terminalElement);
    term.fitAddon.fit();

    window.addEventListener('resize', () => {
      term.fitAddon.fit();
    });
  }

  const downloadOutput =
    document.getElementById('download') as HTMLSelectElement;
  downloadOutput.addEventListener('click', downloadTerminalContents);

  const clearOutput = document.getElementById('clear') as HTMLSelectElement;
  clearOutput.addEventListener('click', ()=>{
    term.clear();
  });
});

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
 * シリアルポート
 */

/**
 * シリアルポートの選択
 */
declare class PortOption extends HTMLOptionElement {
  port: SerialPort;
}

/**
 * PicoSerialクラスは、シリアルポートの選択と接続を管理します。
 */
class PicoSerial {
  public portSelector: HTMLSelectElement;
  public connectButton: HTMLButtonElement;
  private portCounter = 1;
  public picoport: SerialPort | undefined;
  public picoreader:
    ReadableStreamDefaultReader | ReadableStreamBYOBReader | undefined;
  /**
   * Returns the option corresponding to the given SerialPort if one is present
   * in the selection dropdown.
   *
   * @param {SerialPort} port the port to find
   * @return {PortOption}
   */
  findPortOption(port: SerialPort):
    PortOption | null {
    for (let i = 0; i < this.portSelector.options.length; ++i) {
      const option = this.portSelector.options[i];
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
  addNewPort(port: SerialPort): PortOption {
    const portOption = document.createElement('option') as PortOption;
    portOption.textContent = `Port ${this.portCounter++}`;
    portOption.port = port;
    this.portSelector.appendChild(portOption);
    return portOption;
  }

  /**
  * Adds the given port to the selection dropdown, or returns the existing
  * option if one already exists.
  *
  * @param {SerialPort} port the port to add
  * @return {PortOption}
  */
  maybeAddNewPort(port: SerialPort): PortOption {
    const portOption = this.findPortOption(port);
    if (portOption) {
      return portOption;
    }
    return this.addNewPort(port);
  }

  /**
  * Sets |port| to the currently selected port. If none is selected then the
  * user is prompted for one.
  */
  async getSelectedPort(): Promise<void> {
    if (this.portSelector.value == 'prompt') {
      try {
        const serial = navigator.serial;
        this.picoport = await serial.requestPort({});
      } catch (e) {
        return;
      }
      const portOption = this.maybeAddNewPort(this.picoport);
      portOption.selected = true;
    } else {
      const selectedOption = this.portSelector.selectedOptions[0] as PortOption;
      this.picoport = selectedOption.port;
    }
  }

  /**
  * Closes the currently active connection.
  */
  async disconnectFromPort(): Promise<void> {
    // Move |port| into a local variable so that connectToPort() doesn't try to
    // close it on exit.
    const localPort = this.picoport;
    this.picoport = undefined;

    if (this.picoreader) {
      await this.picoreader.cancel();
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
}

const picoserial = new PicoSerial();

document.addEventListener('DOMContentLoaded', async () => {
  picoserial.portSelector =
    document.getElementById('ports') as HTMLSelectElement;
  const ports: (SerialPort)[] = await navigator.serial.getPorts();
  ports.forEach((port) => picoserial.addNewPort(port));


  picoserial.connectButton =
    document.getElementById('connect') as HTMLButtonElement;
  picoserial.connectButton.addEventListener('click', () => {
    if (picoserial.picoport) {
      picoserial.disconnectFromPort();
    } else {
      pico.openpicoport(); // ポートを開く
      pico.readpicoport(); // ポートから読み取りターミナルに出力
    }
  });

  // These events are not supported by the polyfill.
  // https://github.com/google/web-serial-polyfill/issues/20
  navigator.serial.addEventListener('connect', (event) => {
    const portOption = picoserial.addNewPort(event.target as SerialPort);
    portOption.selected = true;
  });
  navigator.serial.addEventListener('disconnect', (event) => {
    const portOption = picoserial.findPortOption(event.target as SerialPort);
    if (portOption) {
      portOption.remove();
    }
  });
});

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
    if (picoserial.picoport && picoserial.picoport.writable) {
      this.writer = picoserial.picoport.writable.getWriter();
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
    if (picoserial.picoreader) {
      await picoserial.picoreader.cancel(); // ターミナル出力を停止
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
    if (picoserial.picoreader) {
      await picoserial.picoreader.cancel(); // ターミナル出力を停止
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
    picoserial.portSelector.disabled = false;
    picoserial.connectButton.textContent = 'Connect';
    picoserial.connectButton.disabled = false;
    picoserial.connectButton.classList.add('button-default');
    picoserial.picoport = undefined;
  }

  /**
   * Open the port.
   */
  async openpicoport(): Promise<void> {
    await picoserial.getSelectedPort();
    if (!picoserial.picoport) {
      return;
    }
    const options = {
      baudRate: 115200,
    };
    picoserial.portSelector.disabled = true;
    picoserial.connectButton.textContent = 'Connecting...';
    picoserial.connectButton.classList.remove('button-default');
    try {
      await picoserial.picoport.open(options);
      term.writeln('<CONNECTED>');
      picoserial.connectButton.textContent = 'Disconnect';
      picoserial.connectButton.disabled = false;
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
    if (picoserial.picoport) {
      try {
        await picoserial.picoport.close();
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
    if (picoserial.picoport && picoserial.picoport.readable) {
      picoserial.picoreader = picoserial.picoport.readable.getReader();
      const generator = readFromPort(targetChar);
      if (picoserial.picoreader) {
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
          picoserial.picoreader.releaseLock();
          picoserial.picoreader = undefined;
        }
      }
    }
    return result;
  }
  /**
   * read the port.
   */
  async readpicoport(): Promise<void> {
    if (picoserial.picoport && picoserial.picoport.readable) {
      picoserial.picoreader = picoserial.picoport.readable.getReader();
      const generator = readFromPort(false);
      if (picoserial.picoreader) {
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
          picoserial.picoreader.releaseLock();
          picoserial.picoreader = undefined;
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
  if (picoserial.picoreader) {
    while (true) {
      const {value, done} = await picoserial.picoreader.read();
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
 * Load main.py from the MicroPython device and display it in the editor.
 *
 * @param {monaco.editor.IStandaloneCodeEditor} editor
 *  - The Monaco editor instance.
 */
async function loadTempPy(editor: monaco.editor.IStandaloneCodeEditor) {
  if (picoserial.picoreader) {
    await picoserial.picoreader.cancel(); // ターミナル出力を停止
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
