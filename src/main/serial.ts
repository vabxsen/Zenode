// Runs async jobs one after another: each starts once the previous one has
// finished (or failed), so read-change-write jobs never overwrite each other.
export function serial(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job)
    tail = run.catch(() => undefined)
    return run
  }
}
