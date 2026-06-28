(function () {
  function esc(str) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }

  var CustomSelect = {
    init: function () {
      var self = this;
      document.addEventListener("click", function (e) {
        var openDropdowns = document.querySelectorAll(".custom-select.open");
        for (var i = 0; i < openDropdowns.length; i++) {
          var dropdown = openDropdowns[i];
          if (!dropdown.contains(e.target)) {
            dropdown.classList.remove("open");
          }
        }

        var trigger = self.closest(e.target, ".select-trigger");
        if (trigger) {
          var dropdown = self.closest(trigger, ".custom-select");
          if (dropdown) {
            dropdown.classList.toggle("open");
          }
          return;
        }

        var option = self.closest(e.target, ".select-option");
        if (option) {
          var dropdown = self.closest(option, ".custom-select");
          if (dropdown) {
            var val = option.getAttribute("data-value");
            dropdown.value = val;
            dropdown.classList.remove("open");
          }
        }
      });

      var dropdowns = document.querySelectorAll(".custom-select");
      for (var j = 0; j < dropdowns.length; j++) {
        this.bindElement(dropdowns[j]);
      }
    },

    closest: function (el, selector) {
      var matches = el.matches || el.webkitMatchesSelector || el.mozMatchesSelector || el.msMatchesSelector;
      while (el) {
        if (matches && matches.call(el, selector)) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    },

    getOptionLabel: function (option) {
      return option.getAttribute("data-label") || option.textContent.trim();
    },

    getOptionHTML: function (option) {
      if (option.hasAttribute("data-label")) {
        return esc(option.getAttribute("data-label"));
      }
      return esc(option.textContent.trim());
    },

    bindElement: function (el) {
      if (el._customSelectBound) return;
      el._customSelectBound = true;

      var initialOption = el.querySelector(".select-option.active") || el.querySelector(".select-option");
      var initialVal = initialOption ? initialOption.getAttribute("data-value") : "";
      el.setAttribute("data-value", initialVal);

      var self = this;

      Object.defineProperty(el, "value", {
        get: function () {
          return this.getAttribute("data-value") || "";
        },
        set: function (newVal) {
          this.setAttribute("data-value", newVal);

          var options = this.querySelectorAll(".select-option");
          var displayHTML = "";
          var found = false;

          for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (opt.getAttribute("data-value") === newVal) {
              opt.classList.add("active");
              displayHTML = self.getOptionHTML(opt);
              found = true;
            } else {
              opt.classList.remove("active");
            }
          }

          if (!found) {
            var firstVisible = null;
            for (var fi = 0; fi < options.length; fi++) {
              if (options[fi].style.display !== "none") { firstVisible = options[fi]; break; }
            }
            if (firstVisible) {
              newVal = firstVisible.getAttribute("data-value");
              this.setAttribute("data-value", newVal);
              firstVisible.classList.add("active");
              displayHTML = self.getOptionHTML(firstVisible);
              found = true;
            }
          }

          var textSpan = this.querySelector(".select-value");
          if (textSpan) {
            if (found) {
              textSpan.innerHTML = displayHTML;
            } else {
              textSpan.textContent = newVal;
            }
          }

          var event;
          try {
            event = new Event("change", { bubbles: true });
          } catch (e) {
            event = document.createEvent("Event");
            event.initEvent("change", true, true);
          }
          this.dispatchEvent(event);
        },
        configurable: true
      });

      if (initialOption) {
        var textSpan = el.querySelector(".select-value");
        if (textSpan) {
          textSpan.innerHTML = self.getOptionHTML(initialOption);
        }
      }
    }
  };

  window.CustomSelect = CustomSelect;
  document.addEventListener("DOMContentLoaded", function () {
    CustomSelect.init();
  });
})();
