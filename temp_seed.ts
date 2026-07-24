import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("/work/temp/constraints_seed_data.json", "utf-8"));
console.log(`Total constraints: ${data.length}`);

const batchSize = 20;
const batches: any[][] = [];
for (let i = 0; i < data.length; i += batchSize) {
  batches.push(data.slice(i, i + batchSize));
}

for (let i = 0; i < batches.length; i++) {
  const argsFile = `/tmp/convex_batch_${i}.json`;
  writeFileSync(argsFile, JSON.stringify({ items: batches[i] }));
  
  try {
    const result = execSync(
      `cd /work/viktor-spaces/production-manager && CONVEX_TMPDIR=./tmp_convex bunx convex run --no-push seedConstraints:seedBatch "$(cat ${argsFile})"`,
      { encoding: "utf-8", timeout: 30000 }
    );
    console.log(`  Batch ${i + 1}/${batches.length}: ${result.trim()}`);
  } catch (e: any) {
    console.error(`  Batch ${i + 1} FAILED: ${e.stderr?.slice(0, 200)}`);
    process.exit(1);
  }
}

console.log("Done!");
