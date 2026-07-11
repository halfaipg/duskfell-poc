export function getAppDom() {
  const canvas = document.getElementById("world");
  return {
    canvas,
    screenCtx: canvas.getContext("2d"),
    ui: {
      connection: document.getElementById("connection"),
      hud: document.getElementById("hud"),
      playerPanel: document.getElementById("playerPanel"),
      panelClose: document.getElementById("panelClose"),
      panelOpen: document.getElementById("panelOpen"),
      playerCardPortrait: document.getElementById("playerCardPortrait"),
      playerCardName: document.getElementById("playerCardName"),
      playerCardArchetype: document.getElementById("playerCardArchetype"),
      partyStatus: document.getElementById("partyStatus"),
      nameInput: document.getElementById("nameInput"),
      renameButton: document.getElementById("renameButton"),
      chatInput: document.getElementById("chatInput"),
      dialogueLog: document.getElementById("dialogueLog"),
      deedStatus: document.getElementById("deedStatus"),
      resourceStatus: document.getElementById("resourceStatus"),
      chainMode: document.getElementById("chainMode"),
      pendingJobs: document.getElementById("pendingJobs"),
      confirmedJobs: document.getElementById("confirmedJobs"),
      latestReceipt: document.getElementById("latestReceipt"),
    },
  };
}
