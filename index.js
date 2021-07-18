const Fchat = require("lib-fchat/lib/Fchat");
const config = require("./config");
const connectionInfo = require("./connection_info");

var fchat = new Fchat(config);

fchat.onOpen(ticket => {
    console.log(`Websocket connection opened. Identifying with ticket: ${ticket}`);
});

fchat.on("IDN", () => {
    console.log(`Identification as ${fchat.user.character} Successful!`);
});

fchat.on("ERR", event => {
    console.log('ERR', event)
})

fchat.on("JCH", event => {
    console.log('Joined channel', event.title)
})

fchat.on("CON", () => {
    // [session=Truth or Dare, Pie Corner]adh-3d665c7ad3a74fcd1b4b[/session]
    // [session=Bot test - ignore me]adh-34e712245998e51b61e3[/session]

    // fchat.send("JCH", { channel: 'adh-3d665c7ad3a74fcd1b4b' });
    fchat.send("JCH", { channel: 'adh-34e712245998e51b61e3' });
    // fchat.send("JCH", { channel: 'development' });
})

fchat.connect(connectionInfo.account, connectionInfo.password, connectionInfo.character);
