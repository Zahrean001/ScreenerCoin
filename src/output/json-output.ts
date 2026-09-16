import { ScreenerOutput } from '../data/types.js';
import { CONFIG } from '../config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class JsonOutput {
  private outputPath: string;

  constructor(outputPath: string = CONFIG.JSON_OUTPUT_PATH) {
    this.outputPath = outputPath;
    const dir = path.dirname(this.outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  write(output: ScreenerOutput): void {
    fs.writeFileSync(this.outputPath, JSON.stringify(output, null, 2));
  }
}
