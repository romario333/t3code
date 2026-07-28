const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutIosPersonalTeamCapabilities(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["aps-environment"];
    delete modConfig.modResults["com.apple.developer.applesignin"];
    delete modConfig.modResults["com.apple.security.application-groups"];
    // FORK: associated domains need a paid team to provision, and the domain
    // (clerk.t3.codes) is not one a fork controls. Nothing in local pairing
    // uses universal links or shared web credentials.
    delete modConfig.modResults["com.apple.developer.associated-domains"];
    return modConfig;
  });
};
