import * as constants from "../src/shared/arena/constants";
import { skillMatrix } from "../src/shared/arena/skill";
const results = skillMatrix(), mover = results[0]!, aimer = results[1]!, ratio = aimer.medianScore / mover.medianScore;
console.log(JSON.stringify({ results, ratio, constants }, null, 2));
if (results.some(r => r.seeds.length !== 20 || r.medianScore <= 0) || ratio < 2) process.exitCode = 1;
