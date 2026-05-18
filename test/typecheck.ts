import type {AttributeValue, ChildValue, EventValue, PropertyValue, TemplateNodes, TemplateView} from '../html.js'
import {force, html} from '../html.js'

const asTemplateStrings = <const Parts extends readonly [string, ...string[]]>(parts: Parts) =>
	parts as unknown as TemplateStringsArray & Parts

const key = Symbol()
const text = 'hello'
const nodes = html`<div>${text}</div>`(key)
nodes[0]

const view: TemplateView = html`<div>${['a', 1, document.createElement('span')]}</div>`
const hydratedNodes: TemplateNodes = view(key, [document.createElement('div')])
const childValue: ChildValue = html`<span>child</span>`
const attributeValue: AttributeValue = 123
const forcedText = force('forced')
forcedText

type InputValue = PropertyValue<'input', 'value'>
const inputValue: InputValue = 'ok'

type ClickHandler = EventValue<MouseEvent>
const clickHandler: ClickHandler = event => event.clientX
const stringHandler: ClickHandler = 'console.log(event.type)'
const removedHandler: ClickHandler = false

attributeValue
childValue
hydratedNodes
inputValue
clickHandler
stringHandler
removedHandler

html`<input value=${'ok'} checked=${true} />`
html`<input value=${force('ok')} checked=${true} />`
html(asTemplateStrings(['<input value=', ' checked=', ' />'] as const), 'ok', true)
html(
	asTemplateStrings(['<div tabindex=', ' title=', ' data-count=', ' aria-hidden=', '></div>'] as const),
	1,
	'hello',
	1,
	true,
)
html(asTemplateStrings(['<input .value=', ' .checked=', ' />'] as const), 'ok', true)
html(asTemplateStrings(['<div .tabIndex=', '></div>'] as const), 1)
html(asTemplateStrings(['<input ?checked=', ' ?disabled=', ' />'] as const), true, false)
html(asTemplateStrings(['<button @click=', '></button>'] as const), (event: MouseEvent) => event.clientX)
html(asTemplateStrings(['<button @click=', '></button>'] as const), 'console.log(event.type)')
html(asTemplateStrings(['<button @click=', '></button>'] as const), false)

// Direct tagged-template error cases are currently blocked by TemplateStringsArray inference in TypeScript.
// These explicit tuple-backed calls verify the same hole typing logic end to end.
// @ts-expect-error input.value should be string
html(asTemplateStrings(['<input value=', ' />'] as const), 123)

// @ts-expect-error input.checked should be boolean
html(asTemplateStrings(['<input checked=', ' />'] as const), 'true')

// @ts-expect-error tabindex maps to the numeric tabIndex property
html(asTemplateStrings(['<div tabindex=', '></div>'] as const), '1')

// @ts-expect-error input.value property should be string
html(asTemplateStrings(['<input .value=', ' />'] as const), 123)

// @ts-expect-error input.checked property should be boolean
html(asTemplateStrings(['<input .checked=', ' />'] as const), 'yes')

// @ts-expect-error boolean attributes should use booleans
html(asTemplateStrings(['<input ?checked=', ' />'] as const), 'true')

// @ts-expect-error click handlers should receive MouseEvent
html(asTemplateStrings(['<button @click=', '></button>'] as const), (event: KeyboardEvent) => event.key)

// @ts-expect-error click handlers must be function, string, nullish, or false
html(asTemplateStrings(['<button @click=', '></button>'] as const), 123)

// @ts-expect-error input handlers should receive Event
html(asTemplateStrings(['<input @input=', ' />'] as const), (event: MouseEvent) => event.clientX)

// @ts-expect-error attribute values should be stringable primitives
const badAttributeValue: AttributeValue = () => 'nope'

// @ts-expect-error input.value should be string
const badInputValue: InputValue = 123

// @ts-expect-error click handlers must be function, string, nullish, or false
const badClickHandler: ClickHandler = 123
