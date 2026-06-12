import {html} from '../../../../html.js'

// nimble-html/missing-closing-tag
// prettier-ignore
html`<section><div></div>`

// nimble-html/mismatched-closing-tag
html`<div></span></div>`

// nimble-html/implicit-optional-end-tag
// prettier-ignore
html`<ul><li>one<li>two</li></ul>`

// nimble-html/invalid-nesting
html`<em><p>text</p></em>`

// nimble-html/invalid-nesting
html`<a href="#"><a href="#">nested</a></a>`

// nimble-html/implicit-tbody
// prettier-ignore
html`<table><tr><td>cell</td></tr></table>`

// nimble-html/invalid-table-structure
// prettier-ignore
html`<table><td>cell</td></table>`

// nimble-html/invalid-table-structure
// prettier-ignore
html`<div><tr><td>cell</td></tr></div>`

const value = 'x'

// nimble-html/duplicate-attribute
html`<div>
	<span title=${value} title="y"></span>
</div>`

// nimble-html/void-content
html`<input>text</input>`

// nimble-html/close-tag-attribute
html`<div></div class="x">`

// nimble-html/invalid-element-name
html`<not></not>`

// nimble-html/invalid-element-parent
html`<body>
	<title>x</title>
</body>`
