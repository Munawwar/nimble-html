import type {AttributeValue, ChildValue, EventValue, PropertyValue, TemplateNodes, TemplateView} from '../html.js'
import {force, html} from '../html.js'

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

// @ts-expect-error attribute values should be stringable primitives
const badAttributeValue: AttributeValue = () => 'nope'

// @ts-expect-error input.value should be string
const badInputValue: InputValue = 123

// @ts-expect-error click handlers must be function, string, nullish, or false
const badClickHandler: ClickHandler = 123
