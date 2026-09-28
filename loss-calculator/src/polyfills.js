/* Полифилы для старых браузеров (IE11, Chrome/Firefox 2015–2017, Safari 9+). Только ES5. */
(function () {
  'use strict';
  function def(obj, name, fn) {
    if (!obj[name]) Object.defineProperty(obj, name, { value: fn, configurable: true, writable: true });
  }
  def(Number, 'isFinite', function (x) { return typeof x === 'number' && isFinite(x); });
  def(Number, 'isNaN', function (x) { return typeof x === 'number' && x !== x; });
  def(Number, 'isInteger', function (x) { return Number.isFinite(x) && Math.floor(x) === x; });
  def(Object, 'assign', function (target) {
    var to = Object(target);
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src != null) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) to[k] = src[k];
    }
    return to;
  });
  def(Object, 'entries', function (o) {
    var r = [];
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r.push([k, o[k]]);
    return r;
  });
  def(Array.prototype, 'find', function (fn, t) {
    for (var i = 0; i < this.length; i++) if (fn.call(t, this[i], i, this)) return this[i];
    return undefined;
  });
  def(Array.prototype, 'findIndex', function (fn, t) {
    for (var i = 0; i < this.length; i++) if (fn.call(t, this[i], i, this)) return i;
    return -1;
  });
  def(Array.prototype, 'includes', function (v) {
    for (var i = 0; i < this.length; i++) if (this[i] === v || (v !== v && this[i] !== this[i])) return true;
    return false;
  });
  def(Array.prototype, 'fill', function (v, start, end) {
    var len = this.length;
    var s = start == null ? 0 : (start < 0 ? Math.max(len + start, 0) : Math.min(start, len));
    var e = end == null ? len : (end < 0 ? Math.max(len + end, 0) : Math.min(end, len));
    for (var i = s; i < e; i++) this[i] = v;
    return this;
  });
  def(Array, 'from', function (a) { return Array.prototype.slice.call(a); });
  def(String.prototype, 'endsWith', function (s) { return this.slice(-String(s).length) === String(s) || String(s) === ''; });
  def(String.prototype, 'startsWith', function (s, pos) { pos = pos || 0; return this.substr(pos, String(s).length) === String(s); });
  def(String.prototype, 'includes', function (s, pos) { return this.indexOf(s, pos || 0) !== -1; });

  if (typeof window === 'undefined') return;
  if (window.NodeList && !NodeList.prototype.forEach) NodeList.prototype.forEach = Array.prototype.forEach;
  var EP = window.Element && Element.prototype;
  if (EP) {
    if (!EP.matches) EP.matches = EP.msMatchesSelector || EP.webkitMatchesSelector;
    if (!EP.closest) {
      EP.closest = function (sel) {
        var el = this;
        while (el && el.nodeType === 1) { if (el.matches(sel)) return el; el = el.parentNode; }
        return null;
      };
    }
    if (!EP.remove) EP.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  }

  // <details>/<summary> для IE и старого Edge
  if (!('open' in document.createElement('details'))) {
    document.documentElement.className += ' no-details';
    document.addEventListener('click', function (e) {
      var s = e.target && e.target.closest ? e.target.closest('summary') : null;
      if (!s || !s.parentNode || s.parentNode.nodeName.toLowerCase() !== 'details') return;
      e.preventDefault(); // не даём переключить дважды, если браузер умеет это сам
      var d = s.parentNode;
      if (d.hasAttribute('open')) d.removeAttribute('open'); else d.setAttribute('open', '');
    });
  }
})();
