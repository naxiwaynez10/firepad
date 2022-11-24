var firepad = firepad || {};

firepad.Firepad = (function (global) {
  if (!firepad.RichTextCodeMirrorAdapter) {
    throw new Error(
      "Oops! It looks like you're trying to include lib/firepad.js directly.  This is actually one of many source files that make up firepad.  You want dist/firepad.js instead."
    );
  }
  var RichTextCodeMirrorAdapter = firepad.RichTextCodeMirrorAdapter;
  var RichTextCodeMirror = firepad.RichTextCodeMirror;
  var RichTextToolbar = firepad.RichTextToolbar;
  var ACEAdapter = firepad.ACEAdapter;
  var MonacoAdapter = firepad.MonacoAdapter;
  var FirebaseAdapter = firepad.FirebaseAdapter;
  var EditorClient = firepad.EditorClient;
  var EntityManager = firepad.EntityManager;
  var ATTR = firepad.AttributeConstants;
  var utils = firepad.utils;
  var LIST_TYPE = firepad.LineFormatting.LIST_TYPE;
  var CodeMirror = global.CodeMirror;
  var ace = global.ace;
  var monaco = global.monaco;

  function Firepad(ref, place, options) {
    if (!(this instanceof Firepad)) {
      return new Firepad(ref, place, options);
    }

    if (!CodeMirror && !ace && !global.monaco) {
      throw new Error(
        "Couldn't find CodeMirror, ACE or Monaco.  Did you forget to include codemirror.js/ace.js or import monaco?"
      );
    }

    this.zombie_ = false;

    if (CodeMirror && place instanceof CodeMirror) {
      this.codeMirror_ = this.editor_ = place;
      var curValue = this.codeMirror_.getValue();
      if (curValue !== "") {
        throw new Error(
          "Can't initialize Firepad with a CodeMirror instance that already contains text."
        );
      }
    } else if (ace && place && place.session instanceof ace.EditSession) {
      this.ace_ = this.editor_ = place;
      curValue = this.ace_.getValue();
      if (curValue !== "") {
        throw new Error(
          "Can't initialize Firepad with an ACE instance that already contains text."
        );
      }
    } else if (
      global.monaco &&
      place &&
      place instanceof global.monaco.constructor
    ) {
      monaco = global.monaco;
      this.monaco_ = this.editor_ = place;
      curValue = this.monaco_.getValue();
      if (curValue !== "") {
        throw new Error(
          "Can't initialize Firepad with a Monaco instance that already contains text."
        );
      }
    } else {
      this.codeMirror_ = this.editor_ = new CodeMirror(place);
    }

    var editorWrapper;
    if (this.codeMirror_) {
      editorWrapper = this.codeMirror_.getWrapperElement();
    } else if (this.ace_) {
      editorWrapper = this.ace_.container;
    } else {
      editorWrapper = this.monaco_.getDomNode();
    }

    // var editorWrapper = this.codeMirror_ ? this.codeMirror_.getWrapperElement() : this.ace_.container;
    this.firepadWrapper_ = utils.elt("div", null, { class: "firepad" });
    editorWrapper.parentNode.replaceChild(this.firepadWrapper_, editorWrapper);
    this.firepadWrapper_.appendChild(editorWrapper);

    // Provide an easy way to get the firepad instance associated with this CodeMirror instance.
    this.editor_.firepad = this;

    this.options_ = options || {};

    if (this.getOption("richTextShortcuts", false)) {
      if (!CodeMirror.keyMap["richtext"]) {
        this.initializeKeyMap_();
      }
      this.codeMirror_.setOption("keyMap", "richtext");
      this.firepadWrapper_.className += " firepad-richtext";
    }

    this.imageInsertionUI = this.getOption("imageInsertionUI", true);

    if (this.getOption("richTextToolbar", false)) {
      this.addToolbar_();
      this.firepadWrapper_.className +=
        " firepad-richtext firepad-with-toolbar";
    }

    this.addPoweredByLogo_();

    // Now that we've mucked with CodeMirror, refresh it.
    if (this.codeMirror_) this.codeMirror_.refresh();

    var userId = this.getOption("userId", ref.push().key);
    var userColor = this.getOption("userColor", colorFromUserId(userId));

    this.entityManager_ = new EntityManager();

    this.firebaseAdapter_ = new FirebaseAdapter(ref, userId, userColor);
    if (this.codeMirror_) {
      this.richTextCodeMirror_ = new RichTextCodeMirror(
        this.codeMirror_,
        this.entityManager_,
        { cssPrefix: "firepad-" }
      );
      this.editorAdapter_ = new RichTextCodeMirrorAdapter(
        this.richTextCodeMirror_
      );
    } else if (this.ace_) {
      this.editorAdapter_ = new ACEAdapter(this.ace_);
    } else {
      this.editorAdapter_ = new MonacoAdapter(this.monaco_);
    }
    this.client_ = new EditorClient(this.firebaseAdapter_, this.editorAdapter_);

    var self = this;
    this.firebaseAdapter_.on("cursor", function () {
      self.trigger.apply(self, ["cursor"].concat([].slice.call(arguments)));
    });

    if (this.codeMirror_) {
      this.richTextCodeMirror_.on("newLine", function () {
        self.trigger.apply(self, ["newLine"].concat([].slice.call(arguments)));
      });
    }

    this.firebaseAdapter_.on("ready", function () {
      self.ready_ = true;

      if (this.ace_) {
        this.editorAdapter_.grabDocumentState();
      }
      if (this.monaco_) {
        this.editorAdapter_.grabDocumentState();
      }

      var defaultText = self.getOption("defaultText", null);
      if (defaultText && self.isHistoryEmpty()) {
        self.setText(defaultText);
        MathJax.typeset();
      }

      self.trigger("ready");
    });

    this.client_.on("synced", function (isSynced) {
      self.trigger("synced", isSynced);
    });

    // Hack for IE8 to make font icons work more reliably.
    // http://stackoverflow.com/questions/9809351/ie8-css-font-face-fonts-only-working-for-before-content-on-over-and-sometimes
    if (
      navigator.appName == "Microsoft Internet Explorer" &&
      navigator.userAgent.match(/MSIE 8\./)
    ) {
      window.onload = function () {
        var head = document.getElementsByTagName("head")[0],
          style = document.createElement("style");
        style.type = "text/css";
        style.styleSheet.cssText = ":before,:after{content:none !important;}";
        head.appendChild(style);
        setTimeout(function () {
          head.removeChild(style);
        }, 0);
      };
    }
  }
  utils.makeEventEmitter(Firepad);

  // For readability, these are the primary "constructors", even though right now they're just aliases for Firepad.
  Firepad.fromCodeMirror = Firepad;
  Firepad.fromACE = Firepad;
  Firepad.fromMonaco = Firepad;

  Firepad.prototype.dispose = function () {
    this.zombie_ = true; // We've been disposed.  No longer valid to do anything.

    // Unwrap the editor.
    // var editorWrapper = this.codeMirror_ ? this.codeMirror_.getWrapperElement() : this.ace_.container;
    if (this.codeMirror_) {
      editorWrapper = this.codeMirror_.getWrapperElement();
    } else if (this.ace_) {
      editorWrapper = this.ace_.container;
    } else {
      editorWrapper = this.monaco_.getDomNode();
    }

    this.firepadWrapper_.removeChild(editorWrapper);
    this.firepadWrapper_.parentNode.replaceChild(
      editorWrapper,
      this.firepadWrapper_
    );

    this.editor_.firepad = null;

    if (
      this.codeMirror_ &&
      this.codeMirror_.getOption("keyMap") === "richtext"
    ) {
      this.codeMirror_.setOption("keyMap", "default");
    }

    this.firebaseAdapter_.dispose();
    this.editorAdapter_.detach();
    if (this.richTextCodeMirror_) this.richTextCodeMirror_.detach();
  };

  Firepad.prototype.setUserId = function (userId) {
    this.firebaseAdapter_.setUserId(userId);
  };

  Firepad.prototype.setUserColor = function (color) {
    this.firebaseAdapter_.setColor(color);
  };

  Firepad.prototype.getText = function () {
    this.assertReady_("getText");
    if (this.codeMirror_) return this.richTextCodeMirror_.getText();
    else if (this.ace_) return this.ace_.getSession().getDocument().getValue();
    else return this.monaco_.getModel().getValue();
  };

  Firepad.prototype.setText = function (textPieces) {
    this.assertReady_("setText");
    if (this.monaco_) {
      return this.monaco_.getModel().setValue(textPieces);
    } else if (this.ace_) {
      return this.ace_.getSession().getDocument().setValue(textPieces);
    } else {
      // HACK: Hide CodeMirror during setText to prevent lots of extra renders.
      this.codeMirror_.getWrapperElement().style.display = "none";
      this.codeMirror_.setValue("");
      this.insertText(0, textPieces);
      this.codeMirror_.getWrapperElement().style.display = "";
      this.codeMirror_.refresh();
    }
    this.editorAdapter_.setCursor({ position: 0, selectionEnd: 0 });
  };

  Firepad.prototype.insertTextAtCursor = function (textPieces) {
    this.insertText(
      this.codeMirror_.indexFromPos(this.codeMirror_.getCursor()),
      textPieces
    );
  };

  Firepad.prototype.insertText = function (index, textPieces) {
    utils.assert(!this.ace_, "Not supported for ace yet.");
    utils.assert(!this.monaco_, "Not supported for monaco yet.");
    this.assertReady_("insertText");

    // Wrap it in an array if it's not already.
    if (Object.prototype.toString.call(textPieces) !== "[object Array]") {
      textPieces = [textPieces];
    }

    var self = this;
    self.codeMirror_.operation(function () {
      // HACK: We should check if we're actually at the beginning of a line; but checking for index == 0 is sufficient
      // for the setText() case.
      var atNewLine = index === 0;
      var inserts = firepad.textPiecesToInserts(atNewLine, textPieces);

      for (var i = 0; i < inserts.length; i++) {
        var string = inserts[i].string;
        var attributes = inserts[i].attributes;
        self.richTextCodeMirror_.insertText(index, string, attributes);
        index += string.length;
      }
    });
  };

  Firepad.prototype.getOperationForSpan = function (start, end) {
    var text = this.richTextCodeMirror_.getRange(start, end);
    var spans = this.richTextCodeMirror_.getAttributeSpans(start, end);
    var pos = 0;
    var op = new firepad.TextOperation();
    for (var i = 0; i < spans.length; i++) {
      op.insert(text.substr(pos, spans[i].length), spans[i].attributes);
      pos += spans[i].length;
    }
    return op;
  };

  Firepad.prototype.getHtml = function () {
    return this.getHtmlFromRange(null, null);
  };

  Firepad.prototype.getHtmlFromSelection = function () {
    var startPos = this.codeMirror_.getCursor("start"),
      endPos = this.codeMirror_.getCursor("end");
    var startIndex = this.codeMirror_.indexFromPos(startPos),
      endIndex = this.codeMirror_.indexFromPos(endPos);
    return this.getHtmlFromRange(startIndex, endIndex);
  };

  Firepad.prototype.getHtmlFromRange = function (start, end) {
    this.assertReady_("getHtmlFromRange");
    var doc =
      start != null && end != null
        ? this.getOperationForSpan(start, end)
        : this.getOperationForSpan(0, this.codeMirror_.getValue().length);
    return firepad.SerializeHtml(doc, this.entityManager_);
  };

  Firepad.prototype.insertHtml = function (index, html) {
    var lines = firepad.ParseHtml(html, this.entityManager_);
    this.insertText(index, lines);
  };

  Firepad.prototype.insertHtmlAtCursor = function (html) {
    this.insertHtml(
      this.codeMirror_.indexFromPos(this.codeMirror_.getCursor()),
      html
    );
  };

  Firepad.prototype.setHtml = function (html) {
    var lines = firepad.ParseHtml(html, this.entityManager_);
    this.setText(lines);
  };

  Firepad.prototype.isHistoryEmpty = function () {
    this.assertReady_("isHistoryEmpty");
    return this.firebaseAdapter_.isHistoryEmpty();
  };

  Firepad.prototype.bold = function () {
    this.richTextCodeMirror_.toggleAttribute(ATTR.BOLD);
    this.codeMirror_.focus();
  };

  Firepad.prototype.italic = function () {
    this.richTextCodeMirror_.toggleAttribute(ATTR.ITALIC);
    this.codeMirror_.focus();
  };

  Firepad.prototype.underline = function () {
    this.richTextCodeMirror_.toggleAttribute(ATTR.UNDERLINE);
    this.codeMirror_.focus();
  };

  Firepad.prototype.strike = function () {
    this.richTextCodeMirror_.toggleAttribute(ATTR.STRIKE);
    this.codeMirror_.focus();
  };

  Firepad.prototype.fontSize = function (size) {
    this.richTextCodeMirror_.setAttribute(ATTR.FONT_SIZE, size);
    this.codeMirror_.focus();
  };

  Firepad.prototype.font = function (font) {
    this.richTextCodeMirror_.setAttribute(ATTR.FONT, font);
    this.codeMirror_.focus();
  };

  Firepad.prototype.color = function (color) {
    this.richTextCodeMirror_.setAttribute(ATTR.COLOR, color);
    this.codeMirror_.focus();
  };

  Firepad.prototype.highlight = function () {
    this.richTextCodeMirror_.toggleAttribute(
      ATTR.BACKGROUND_COLOR,
      "rgba(255,255,0,.65)"
    );
    this.codeMirror_.focus();
  };

  Firepad.prototype.align = function (alignment) {
    if (
      alignment !== "left" &&
      alignment !== "center" &&
      alignment !== "right"
    ) {
      throw new Error('align() must be passed "left", "center", or "right".');
    }
    this.richTextCodeMirror_.setLineAttribute(ATTR.LINE_ALIGN, alignment);
    this.codeMirror_.focus();
  };

  Firepad.prototype.orderedList = function () {
    this.richTextCodeMirror_.toggleLineAttribute(ATTR.LIST_TYPE, "o");
    this.codeMirror_.focus();
  };

  Firepad.prototype.unorderedList = function () {
    this.richTextCodeMirror_.toggleLineAttribute(ATTR.LIST_TYPE, "u");
    this.codeMirror_.focus();
  };

  Firepad.prototype.todo = function () {
    this.richTextCodeMirror_.toggleTodo();
    this.codeMirror_.focus();
  };

  Firepad.prototype.newline = function () {
    this.richTextCodeMirror_.newline();
  };

  Firepad.prototype.deleteLeft = function () {
    this.richTextCodeMirror_.deleteLeft();
  };

  Firepad.prototype.deleteRight = function () {
    this.richTextCodeMirror_.deleteRight();
  };

  Firepad.prototype.indent = function () {
    this.richTextCodeMirror_.indent();
    this.codeMirror_.focus();
  };

  Firepad.prototype.unindent = function () {
    this.richTextCodeMirror_.unindent();
    this.codeMirror_.focus();
  };

  Firepad.prototype.undo = function () {
    this.codeMirror_.undo();
  };

  Firepad.prototype.redo = function () {
    this.codeMirror_.redo();
  };

  Firepad.prototype.insertEntity = function (type, info, origin) {
    this.richTextCodeMirror_.insertEntityAtCursor(type, info, origin);
  };

  Firepad.prototype.insertEntityAt = function (index, type, info, origin) {
    this.richTextCodeMirror_.insertEntityAt(index, type, info, origin);
  };

  Firepad.prototype.registerEntity = function (type, options) {
    this.entityManager_.register(type, options);
  };

  Firepad.prototype.getOption = function (option, def) {
    return option in this.options_ ? this.options_[option] : def;
  };

  Firepad.prototype.assertReady_ = function (funcName) {
    if (!this.ready_) {
      throw new Error(
        'You must wait for the "ready" event before calling ' + funcName + "."
      );
    }
    if (this.zombie_) {
      throw new Error(
        "You can't use a Firepad after calling dispose()!  [called " +
          funcName +
          "]"
      );
    }
  };

  Firepad.prototype.makeImageDialog_ = function () {
    this.makeDialog_("img", "Insert image url");
  };

  Firepad.prototype.makeDialog_ = function (id, placeholder) {
    var self = this;

    var hideDialog = function () {
      var dialog = document.getElementById("overlay");
      dialog.style.visibility = "hidden";
      self.firepadWrapper_.removeChild(dialog);
    };

    var cb = function () {
      var dialog = document.getElementById("overlay");
      dialog.style.visibility = "hidden";
      var src = document.getElementById(id).value;
      if (src !== null) self.insertEntity(id, { src: src });
      self.firepadWrapper_.removeChild(dialog);
    };

    var input = utils.elt("input", null, {
      class: "firepad-dialog-input",
      id: id,
      type: "text",
      placeholder: placeholder,
      autofocus: "autofocus",
    });

    var submit = utils.elt("a", "Submit", {
      class: "firepad-btn",
      id: "submitbtn",
    });
    utils.on(submit, "click", utils.stopEventAnd(cb));

    var cancel = utils.elt("a", "Cancel", { class: "firepad-btn" });
    utils.on(cancel, "click", utils.stopEventAnd(hideDialog));

    var buttonsdiv = utils.elt("div", [submit, cancel], {
      class: "firepad-btn-group",
    });

    var d = utils.elt("s", "$$int {x + x}, dx + mathrm{cos}left(y+y\right)$$", {
      class: "maths",
    });

    var div = utils.elt("div", [input, buttonsdiv], {
      class: "firepad-dialog-div",
    });
    var dialog = utils.elt("div", [div], {
      class: "firepad-dialog",
      id: "overlay",
    });

    this.firepadWrapper_.appendChild(dialog);
    MathJax.typeset();
  };

  // Testing for Graph Modal

  Firepad.prototype.makeGraph_ = function () {
    var self = this;
    if (window.ggbApplet && ggbApplet.newConstruction) {
      ggbApplet.newConstruction();
    }
    var parameters = {
      appname: "clasic",
      id: "ggbApplet",
      width: 800,
      height: 600,
      showToolBar: true,
      // "borderColor":null,
      showMenuBar: true,
      allowStyleBar: true,
      showAlgebraInput: true,
      enableLabelDrags: false,
      enableShiftDragZoom: true,
      capturingThreshold: null,
      // "showToolBarHelp":false,
      errorDialogsActive: true,
      // "showTutorialLink":false,
      // "showLogging":true,
      useBrowserForJS: true,
      disableAutoScale: true,
      // "perspective":"1",
      useBrowserForJS: false,
      // "ggbbase64": "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"
    };

    var hideDialog = function () {
      var dialog = document.getElementById("overlay");
      dialog.style.visibility = "hidden";
      self.firepadWrapper_.removeChild(dialog);
    };

    var cb = function () {
      var dialog = document.getElementById("overlay");
      updateGraphInputs();
      dialog.style.visibility = "hidden";
      var src =
        "data:image/png;base64," + document.getElementById("graphImg_").value;
      if (src !== null) self.insertEntity("img", { src: src });

      self.firepadWrapper_.removeChild(dialog);
    };

    var updateGraphInputs = function () {
      var str = ggbApplet.getPNGBase64(1, true, 72);
      document.getElementById("graphImg_").value = str;
    };

    var graphArea = utils.elt("div", null, { id: "modal" });

    var submit = utils.elt("a", "Submit", {
      class: "firepad-btn",
      id: "submitbtn",
    });

    utils.on(submit, "click", utils.stopEventAnd(cb));

    var cancel = utils.elt("a", "Cancel", { class: "firepad-btn" });
    utils.on(cancel, "click", utils.stopEventAnd(hideDialog));

    var buttonsdiv = utils.elt("div", [submit, cancel], {
      class: "firepad-btn-group",
    });

    var base64PNGInput = utils.elt("textarea", null, { id: "graphImg_" });
    var base64StateInput = utils.elt("textarea", null, { id: "graphImg__" });

    var div = utils.elt(
      "div",
      [graphArea, base64PNGInput, base64StateInput, buttonsdiv],
      {
        class: "firepad-dialog-div-graph",
      }
    );
    var dialog = utils.elt("div", [div], {
      class: "firepad-dialog",
      id: "overlay",
    });

    this.firepadWrapper_.appendChild(dialog);
    applet = new GGBApplet(parameters, true);
    applet.inject("modal");
  };
  /*** End test */

  /*** Testing for Nermeder solver ***/
  Firepad.prototype.mathsDialog_ = function () {
    var self = this;

    var hideDialog = function () {
      var dialog = document.getElementById("overlay");
      dialog.style.visibility = "hidden";
      self.firepadWrapper_.removeChild(dialog);
    };

    var updateToLaTex = function ({ target }) {
      let i = target.value;
      let s = nerdamer(i).toTeX();
      document.getElementById("maths_").innerText = "\\( " + s + " \\)";
      MathJax.typeset();
    };

    var evaluateMaths = function () {
      let i = document.getElementById("maths-input").value;
      let s = nerdamer(i).toTeX();
      let sol = nerdamer(i).evaluate().text();
      document.getElementById("maths_").innerText =
        "\\( " + s + " = " + sol + " \\)";
      MathJax.typeset();
    };
    var insertMaths = function () {
      var dialog = document.getElementById("overlay");
      dialog.style.visibility = "hidden";
      var input = document.getElementById("maths-input").value;
      if (input !== null) {
        var r = document.getElementById("maths_").innerHTML;
        // console.log(r);
        // var mS = utils.elt("span", {
        //   class: "-h-",
        // });
        // self.insertEntity("div", { id: "/dkosd" });
        // self.setHtml(r);
        // MathJax.typeset();
      }
      self.insertHtmlAtCursor(r);
      self.firepadWrapper_.removeChild(dialog);
    };

    var input = utils.elt("textarea", null, {
      class: "firepad-dialog-input",
      id: "maths-input",
      // type: "text",
      placeholder: "Start typing here...",
      autofocus: "autofocus",
    });
    utils.on(input, "change", utils.stopEventAnd(updateToLaTex));

    var evalBtn = utils.elt("a", "Evaluate", {
      class: "firepad-btn",
      id: "evaluateBtn",
    });
    utils.on(evalBtn, "click", evaluateMaths);
    var div_ = utils.elt("div", [evalBtn], {
      class: "b",
    });
    var evalDiv = utils.elt("div", [input, div_], {
      class: "evalDiv",
    });

    var submit = utils.elt("a", "Submit", {
      class: "firepad-btn",
      id: "submitbtn",
    });
    utils.on(submit, "click", utils.stopEventAnd(insertMaths));

    var cancel = utils.elt("a", "Cancel", { class: "firepad-btn" });
    utils.on(cancel, "click", utils.stopEventAnd(hideDialog));

    var buttonsdiv = utils.elt("div", [submit, cancel], {
      class: "firepad-btn-group",
    });

    var d = utils.elt("div", null, {
      id: "maths_",
    });

    var div = utils.elt("div", [evalDiv, d, buttonsdiv], {
      class: "firepad-dialog-div",
    });
    var dialog = utils.elt("div", [div], {
      class: "firepad-dialog",
      id: "overlay",
    });

    this.firepadWrapper_.appendChild(dialog);
    MathJax.typeset();
  };
  /** End test  */
  Firepad.prototype.addToolbar_ = function () {
    this.toolbar = new RichTextToolbar(this.imageInsertionUI);

    this.toolbar.on("undo", this.undo, this);
    this.toolbar.on("redo", this.redo, this);
    this.toolbar.on("bold", this.bold, this);
    this.toolbar.on("italic", this.italic, this);
    this.toolbar.on("underline", this.underline, this);
    this.toolbar.on("strike", this.strike, this);
    this.toolbar.on("font-size", this.fontSize, this);
    this.toolbar.on("font", this.font, this);
    this.toolbar.on("color", this.color, this);
    this.toolbar.on(
      "left",
      function () {
        this.align("left");
      },
      this
    );
    this.toolbar.on(
      "center",
      function () {
        this.align("center");
      },
      this
    );
    this.toolbar.on(
      "right",
      function () {
        this.align("right");
      },
      this
    );
    this.toolbar.on("ordered-list", this.orderedList, this);
    this.toolbar.on("unordered-list", this.unorderedList, this);
    this.toolbar.on("todo-list", this.todo, this);
    this.toolbar.on("indent-increase", this.indent, this);
    this.toolbar.on("indent-decrease", this.unindent, this);
    this.toolbar.on("insert-image", this.makeImageDialog_, this);
    this.toolbar.on("insert-graph", this.makeGraph_, this);
    this.toolbar.on("solve-graph", this.mathsDialog_, this);

    this.firepadWrapper_.insertBefore(
      this.toolbar.element(),
      this.firepadWrapper_.firstChild
    );
  };

  Firepad.prototype.addPoweredByLogo_ = function () {
    var poweredBy = utils.elt("a", null, { class: "powered-by-firepad" });
    poweredBy.setAttribute("href", "http://www.firepad.io/");
    poweredBy.setAttribute("target", "_blank");
    this.firepadWrapper_.appendChild(poweredBy);
  };

  Firepad.prototype.initializeKeyMap_ = function () {
    function binder(fn) {
      return function (cm) {
        // HACK: CodeMirror will often call our key handlers within a cm.operation(), and that
        // can mess us up (we rely on events being triggered synchronously when we make CodeMirror
        // edits).  So to escape any cm.operation(), we do a setTimeout.
        setTimeout(function () {
          fn.call(cm.firepad);
        }, 0);
      };
    }

    CodeMirror.keyMap["richtext"] = {
      "Ctrl-B": binder(this.bold),
      "Cmd-B": binder(this.bold),
      "Ctrl-I": binder(this.italic),
      "Cmd-I": binder(this.italic),
      "Ctrl-U": binder(this.underline),
      "Cmd-U": binder(this.underline),
      "Ctrl-H": binder(this.highlight),
      "Cmd-H": binder(this.highlight),
      Enter: binder(this.newline),
      Delete: binder(this.deleteRight),
      Backspace: binder(this.deleteLeft),
      Tab: binder(this.indent),
      "Shift-Tab": binder(this.unindent),
      fallthrough: ["default"],
    };
  };

  function colorFromUserId(userId) {
    var a = 1;
    for (var i = 0; i < userId.length; i++) {
      a = (17 * (a + userId.charCodeAt(i))) % 360;
    }
    var hue = a / 360;

    return hsl2hex(hue, 1, 0.75);
  }

  function rgb2hex(r, g, b) {
    function digits(n) {
      var m = Math.round(255 * n).toString(16);
      return m.length === 1 ? "0" + m : m;
    }
    return "#" + digits(r) + digits(g) + digits(b);
  }

  function hsl2hex(h, s, l) {
    if (s === 0) {
      return rgb2hex(l, l, l);
    }
    var var2 = l < 0.5 ? l * (1 + s) : l + s - s * l;
    var var1 = 2 * l - var2;
    var hue2rgb = function (hue) {
      if (hue < 0) {
        hue += 1;
      }
      if (hue > 1) {
        hue -= 1;
      }
      if (6 * hue < 1) {
        return var1 + (var2 - var1) * 6 * hue;
      }
      if (2 * hue < 1) {
        return var2;
      }
      if (3 * hue < 2) {
        return var1 + (var2 - var1) * 6 * (2 / 3 - hue);
      }
      return var1;
    };
    return rgb2hex(hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3));
  }

  return Firepad;
})(this);

// Export Text classes
firepad.Firepad.Formatting = firepad.Formatting;
firepad.Firepad.Text = firepad.Text;
firepad.Firepad.Entity = firepad.Entity;
firepad.Firepad.LineFormatting = firepad.LineFormatting;
firepad.Firepad.Line = firepad.Line;
firepad.Firepad.TextOperation = firepad.TextOperation;
firepad.Firepad.Headless = firepad.Headless;

// Export adapters
firepad.Firepad.RichTextCodeMirrorAdapter = firepad.RichTextCodeMirrorAdapter;
firepad.Firepad.ACEAdapter = firepad.ACEAdapter;
firepad.Firepad.MonacoAdapter = firepad.MonacoAdapter;
