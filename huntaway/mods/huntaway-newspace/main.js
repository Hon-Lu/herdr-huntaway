// huntaway-newspace: the New space dialog. Open it with `mod.open:huntaway-newspace` (a key, the
// palette, or another mod); it searches folders under home, browses any path, and makes a space
// with a terminal in the folder chosen.
import { View } from "gpui-kit";
import { NewSpace } from "./newspace.js";

export default class HuntawayNewSpace extends View {
  init(_props, cx) {
    this.dialog = new NewSpace();
    this.dialog.init(cx, cx.focus_handle());
  }
  render() { return this.dialog.render(); }
  close() { this.dialog?.close(); }
}
