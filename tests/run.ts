// Runs every unit test file in order, then prints the summary.
import { report } from './harness'
import './index.test'
import './safety.test'
import './render.test'
import './editor.test'
import './notes.test'
import './properties.test'

report()
