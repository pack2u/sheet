function debugTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var log = "Triggers:\\n";
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    log += fn + "\\n";
    if (fn === "partnerPushOrdersToExclusiveFormsSilent_" || fn === "_PEP_PUSH_TRIGGER_FUNC") {
      ScriptApp.deleteTrigger(triggers[i]);
      log += " -> Deleted!\\n";
    }
  }
  PropertiesService.getScriptProperties().setProperty("PEP_AUTO_PUSH", "OFF");
  log += "Set PEP_AUTO_PUSH to OFF.\\n";
  console.log(log);
}
