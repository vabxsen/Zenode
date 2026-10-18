// Tiny assertion helper shared by the unit test files (run through tests/run.ts).
let fails = 0
let passes = 0

export function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) passes++
  else fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`)
}

export function report(): never {
  console.log(fails ? `\n${fails} FAILED (${passes} passed)` : `\nALL PASSED (${passes})`)
  process.exit(fails ? 1 : 0)
}
