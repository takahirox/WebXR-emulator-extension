(function () {
    'use strict';

    const connections = {};
    chrome.runtime.onConnect.addListener(port => {
        port.onMessage.addListener((message, sender) => {
            const tabId = message.tabId !== undefined ? message.tabId : sender.sender.tab.id;
            if (connections[tabId] === undefined) {
                connections[tabId] = {};
            }
            const portMap = connections[tabId];
            if (!portMap[port.name]) {
                portMap[port.name] = [];
            }
            if (!portMap[port.name].includes(port)) {
                portMap[port.name].push(port);
                port.onDisconnect.addListener(() => {
                    if (portMap[port.name].includes(port)) {
                        portMap[port.name].splice(portMap[port.name].indexOf(port), 1);
                    }
                    if (portMap[port.name].length === 0) {
                        delete portMap[port.name];
                    }
                    if (Object.keys(portMap).length === 0) {
                        delete connections[tabId];
                    }
                });
            }
            if (port.name === 'panel') {
                postMessageToPorts(portMap.contentScript, message);
            }
            if (port.name === 'contentScript') {
                postMessageToPorts(portMap.panel, message);
            }
        });
    });
    const postMessageToPorts = (ports, message) => {
        ports && ports.forEach(port => {
            port.postMessage(message);
        });
    };

})();
