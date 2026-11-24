/*
 * A small, offline renderer for the design canvas's artboard files (`*.dc.html`), used only to
 * turn the exported mockups in `docs/design/mockups/` into reference PNGs (ADR-281, ADR-282).
 * It understands what our artboards use: `{{ path }}` holes, `<sc-for list as>`, `<sc-if value>`,
 * event attributes bound to functions from `renderVals()`, and a `Component extends DCLogic`
 * class with `state`, `setState`, `componentDidMount`.
 */
(function () {
  "use strict";
  var EVENTS = { onclick: "click", ondoubleclick: "dblclick", oninput: "input", onchange: "change", onsubmit: "submit", onkeydown: "keydown" };
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var ONLY = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scope) {
    var parts = path.trim().split(".");
    var head = parts[0];
    var value;
    for (var i = scope.length - 1; i >= 0; i -= 1) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], head)) { value = scope[i][head]; break; }
    }
    for (var j = 1; j < parts.length && value != null; j += 1) value = value[parts[j]];
    return value;
  }

  function text(str, scope) {
    return str.replace(HOLE, function (_, path) {
      var v = lookup(path, scope);
      return v == null ? "" : String(v);
    });
  }

  function renderInto(nodes, scope, parent) {
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.nodeType === 3) { parent.appendChild(document.createTextNode(text(node.nodeValue, scope))); continue; }
      if (node.nodeType !== 1) continue;
      var sc = node.tagName === "TEMPLATE" ? node.getAttribute("data-sc") : null;
      if (sc === "for") {
        var list = lookup((node.getAttribute("list") || "").replace(/[{}]/g, ""), scope) || [];
        var as = node.getAttribute("as") || "item";
        for (var k = 0; k < list.length; k += 1) {
          var local = {}; local[as] = list[k];
          renderInto(node.content.childNodes, scope.concat([local]), parent);
        }
        continue;
      }
      if (sc === "if") {
        if (lookup((node.getAttribute("value") || "").replace(/[{}]/g, ""), scope)) renderInto(node.content.childNodes, scope, parent);
        continue;
      }
      var el = node.cloneNode(false);
      var attrs = Array.prototype.slice.call(node.attributes);
      var props = [];
      for (var a = 0; a < attrs.length; a += 1) {
        var name = attrs[a].name, raw = attrs[a].value, lower = name.toLowerCase();
        if (EVENTS[lower]) {
          el.removeAttribute(name);
          var only = raw.match(ONLY);
          var fn = only ? lookup(only[1], scope) : null;
          if (typeof fn === "function") el.addEventListener(EVENTS[lower], fn);
          continue;
        }
        if (raw.indexOf("{{") < 0) continue;
        var single = raw.match(ONLY);
        var val = single ? lookup(single[1], scope) : text(raw, scope);
        if (lower === "checked" || lower === "selected" || lower === "disabled") {
          if (val === true || val === "true") { el.setAttribute(name, ""); props.push([lower, true]); } else { el.removeAttribute(name); props.push([lower, false]); }
          continue;
        }
        if (val == null || val === false) { el.removeAttribute(name); continue; }
        el.setAttribute(name, String(val));
        if (lower === "value") props.push(["value", String(val)]);
      }
      if (node.tagName === "TEMPLATE") el.content.appendChild(node.content.cloneNode(true));
      else renderInto(node.childNodes, scope, el);
      for (var p = 0; p < props.length; p += 1) el[props[p][0]] = props[p][1];
      parent.appendChild(el);
    }
  }

  window.DCLogic = function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  };
  window.DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === "function" ? patch(this.state, this.props) : patch;
    Object.assign(this.state, next);
    window.__dcRender();
  };

  window.__dcBoot = function (Component, source) {
    var tpl = document.createElement("template");
    tpl.innerHTML = source;
    var root = document.getElementById("dc-root");
    var inst = new Component({});
    window.__dc = inst;
    window.__dcRender = function () {
      var vals = inst.renderVals ? inst.renderVals() : {};
      var frag = document.createDocumentFragment();
      renderInto(tpl.content.childNodes, [vals], frag);
      root.replaceChildren(frag);
    };
    window.__dcRender();
    if (typeof inst.componentDidMount === "function") inst.componentDidMount();
  };
})();
