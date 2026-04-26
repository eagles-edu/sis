export default function (opts) {
    const defaultSize = (opts && opts.defaultSize) || 32;
    const path = (opts && opts.path) || "svgs/";
    const styleText = `
        :host, :host(.palette0) {color: currentColor;
            --color0: #fff;
            --color1: #000;
        }`;
    function isNumber(x) {
        return !Number.isNaN(x) && typeof x === "number";
    }
    function setSize(svg, size) {
        let height;
        let sizeUnit;
        let viewBox;
        let width;
        if (typeof size === "string") {
            sizeUnit = size.match(/[^\d.]*$/)[0];
            size= parseFloat(size);
        } else if (!isNumber(size)) {
            size = defaultSize;
        }
        if (!isNumber(size)) {
            return;
        }
        viewBox = svg.getAttribute("viewBox");
        if (typeof viewBox === "string") {
            viewBox = viewBox.trim().split(/\s+/);
            width = Number(viewBox[2]);
            height = Number(viewBox[3]);
            if (isNumber(width) && isNumber(height)) {
                width = size * width / height;
                height = size;
            } else {
                width = size;
                height = size;
            }
        }
        if (typeof sizeUnit === "string") {
            width += sizeUnit;
            height += sizeUnit;
        }
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
    }
    customElements.define("svg-icon", class extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({mode: "open"});
        }
        static get observedAttributes() {
            return ["name", "size"];
        }
        connectedCallback() {
            this.render();
        }
        disconnectedCallback() {
            try {
                this.abortSignal.abort();
            } catch (ignore) {}
        }
        render() {
            let name = this.getAttribute("name");
            let size;
            let src = path;
            if (typeof name !== "string") {
                return;
            }
            if (src && !src.endsWith("/")) {
                src = src + "/";
            }
            src = src + name + ".svg";
            try {
                this.abortSignal.abort();
            } catch (ignore) {}
            this.fetchSvg(src).then((svg) => {
                let div = document.createElement("div");
                let style;
                div.innerHTML = svg;
                svg = div.querySelector("svg");
                if (!svg) {
                    return;
                }
                size = this.getAttribute("size");
                if (typeof size === "string") {
                    setSize(svg, size);
                } else {
                    setSize(svg, defaultSize);
                }
                style = document.createElement("style");
                style.textContent = styleText;
                this.shadowRoot.replaceChildren(style, svg);
            });
        }
        attributeChangedCallback(name, oldValue, newValue) {
            let svg = this.shadowRoot.querySelector("svg");
            if (svg) {
                if (name === "size") {
                    setSize(svg, newValue);
                } else {
                    this.render();
                }
            }
        }
        fetchSvg(src) {
            this.abortSignal = (new AbortController()).signal;
            return fetch(src, this.abortSignal).then(function (result) {
                if (result.status === 200) {
                    return result.text();
                }
                return;
            });
        }
    });
};
