/**
 * Copyright (C) 2013-2014, Infthink (Beijing) Technology Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.ß
 */
var ConnectService = (function () {

    window.addEventListener('localized', function onlocalized() {
        // Set the 'lang' and 'dir' attributes to <html> when the page is translated
        document.documentElement.lang = navigator.mozL10n.language.code;
        document.documentElement.dir = navigator.mozL10n.language.direction;
        if (deviceName && connectssid) {
            PageHelper.setElement(deviceName, connectssid);
        }
    });

    var WIFI_CONFIG_STATE = {
        CONFIGURING: 'configuring',
        FAIL: 'fail',
        DISCONNECT: 'disconnect',
        AGAIN: 'again',
        SUCCESS: 'success'
    };

    const DB_NAME = 'netcast_config';
    const DB_VERSION = 1;
    const DB_STORE_NAME = 'wifi_info';

    var settings = navigator.mozSettings;

    var CONNECT_TIME_OUT = 30000;
    var SCAN_TIME_OUT_COUNT = 5;
    var NETWORK_MAX_FIND = 2;

    var netcastDB = new netcastdb.NetcastDB(DB_NAME, DB_STORE_NAME, DB_VERSION);
    var cfdSocket = null;
    var networkManager = networkHelper.getNetworkManager();
    var timezoneChanged = false;
    var isTimeSetBySetting = false;
    var autoScan = false;
    var scanTimeoutCount = 0;
    var aplastScanDate = 0;
    var isInit = false;
    var network_find_count = 0;
    var reconnectTimer;
    var apScanTimer;
    var connectTimer;
    var oldnetworks;

    var connectssid;
    var bssid;
    var password;
    var type;
    var ishidden;
    var configState;
    var deviceName;
    var macAddress;
    var timezone;
    var language;
    var code;
    var deviceVersion = '';
    var isToggled = false;
    var isOldTime = false;
    var requestId = 0;


    var buffer = '';
    var messageSize = -1;

    // handle AP set/reset events
    settings.addObserver('tethering.wifi.enabled', handleHotspotChange);

    /**
     * Handle device time change events
     */
    window.addEventListener('moztimechange', function () {
        console.log('Time has changed: isToggled:' + isToggled + " idOldTime: " + isOldTime + " timezoneChanged: " + timezoneChanged);
        if (timezoneChanged) {
            timezoneChanged = false;
        } else if (isOldTime) {
            settings.createLock().set({
                'time.clock.automatic-update.enabled': true
            });
            isToggled = true;
            isOldTime = false;
        } else if (isToggled) {
            if (isTimeSetBySetting) {
                console.log("Disable auto-update time.");
                settings.createLock().set({
                    'time.clock.automatic-update.enabled': false // disable auto-update time after "time_set".
                });
            } else {
                console.log("Enable auto-update time.");
                settings.createLock().set({
                    'time.clock.automatic-update.enabled': true // enable auto-update time.
                });
            };
            
            console.log("Show Time!");
            PageHelper.showTime();
        }

    });

    // reset current time
    var oldTime = new Date();
    oldTime.setFullYear(2014);
    oldTime.setMonth(0);
    console.log("oldTime:" + oldTime);
    navigator.mozTime.set(oldTime);
    isOldTime = true;

    /**
     * notify flingd/castd about current wifi ssid name
     */
    function notifyNameChanged() {
        var message = JSON.stringify({
            'type': 'SYSTEM_STATUS',
            'name': deviceName,
            'ssid': connectssid,
            'requestId': generateRequestID()
        });
        flingUtils.flingdStatusChange(ConstantUtils.encode(message));
    }

    function generateRequestID() {
        return ++requestId;
    }
    /**
     * Find colon pos in buffer.
     *
     * @param buffer
     * @returns {number}
     */
    function findColon(buffer) {
        var colonCode = ':';
        for (var i = 0; i < buffer.length; ++i) {
            if (buffer[i] === colonCode) {
                return i;
            }
        }
        return -1;
    }

    /**
     * client which will get config info from configd.
     */
    function ConnectConfigDaemon() {

        cfdSocket = navigator.mozTCPSocket.open('127.0.0.1', 8881);
        cfdSocket.onopen = function (event) {
            var registerMessage = MessageDecoder.ProtocolEncode({'name': 'pal'}, 'register', {"reply": false});
            console.log('config socket open register Message: ' + registerMessage);
            cfdSocket.send(registerMessage);
        };

        cfdSocket.onerror = function (event) {
            console.log('config socket error: ' + event.data.name);
        };

        cfdSocket.onclose = function (event) {
            console.log("config socket close");
            cfdSocket.close();
            window.setTimeout(ConnectConfigDaemon, 1000);
        };


        cfdSocket.ondata = function (event) {
            console.log(event.data);
            buffer = buffer.concat(event.data);
            while (true) {
                if (messageSize < 0) {
                    var colonIndex = findColon(buffer);
                    if (colonIndex > 0) {
                        messageSize = parseInt(buffer.slice(0, colonIndex).toString());
                        buffer = buffer.slice(colonIndex + 1);
                    } else {
                        break;
                    }
                }

                if (messageSize > 0) {
                    if (buffer.length >= messageSize) {
                        var msgBuffer = buffer.slice(0, messageSize);
                        try {
                            doDataCommand(JSON.parse(ConstantUtils.decode(msgBuffer).toString()));
                        } catch (e) {
                            console.log(e.message);
                        }
                        if (buffer.length > messageSize) {
                            buffer = buffer.slice(messageSize);
                        } else {
                            buffer = '';
                        }
                        messageSize = -1;
                    } else {
                        break;
                    }
                }
            }
        };

        /**
         * Ready to process config command from configd
         *
         * @param data
         */
        function doDataCommand(data) {
            var message = data.data;

            console.log('message: ' + JSON.stringify(message));
            if (message.command == "setting") {      // 'Set' command
                console.log("setting type:" + message.type);
                if (message.type == "wifi") {    // setup wifi
                    connectssid = message['wifi-name'];
                    bssid = message['wifi-bssid'];
                    password = message['wifi-password'];
                    type = message['wifi-type'];
                    ishidden = message['wifi-hidden'];
                    var configSsid = message['name'];
                    var configTimezone = message['timezone'];
                    if (bssid) {
                        bssid = bssid.toLowerCase();
                    }
                    if (null === ishidden) {
                        ishidden = false;
                    }

                    if (configSsid != undefined && configSsid != null) {
                        handleNameSet(configSsid);
                    }

                    if (configTimezone != undefined && configTimezone != null) {
                        handleTimezoneSet(configTimezone, false);
                    }

                    console.log(connectssid + ":" + password + ":" + bssid);
                    if (reconnectTimer != undefined) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = undefined;
                    }
                    if (connectTimer != undefined) {
                        clearTimeout(connectTimer);
                        connectTimer = undefined;
                    }

                    console.log("wifi change:" + configState);
                    if (configState == WIFI_CONFIG_STATE.SUCCESS) {
                        configState = WIFI_CONFIG_STATE.AGAIN;
                    }
                    handleWifiSet(connectssid, bssid, type, password, ishidden);

                } else if (message.type == "connect_ap") {

                    macAddress = message['ap_mac'];
                    var storeObj = {
                        apmac: macAddress
                    };
                    updateData(storeObj);

                } else if (message.type == "change_ssid") { // change wifi's ssid
                    var new_ssid = message['name'];
                    if (new_ssid != null) {
                        handleNameSet(new_ssid);
                    }

                } else if (message.type == "reset_cast") {   // do recovery action
                    handleResetPhone();

                } else if (message.type == "reboot_cast") { // reboot
                    handleRebootPhone();

                } else if (message.type == 'time_set') {  // set time
                    var tm = message['time'];
                    console.log("message.type time_set: " + tm);
                    if (null != tm) {
                        handleTimeSet(tm);
                    }
                } else if (message.type == 'time_zone') {  // change timezone
                    var tz = message['timezone'];
                    if (null != tz) {
                        handleTimezoneSet(tz, true);
                    }

                } else if (message.type == 'language') {  // change language
                    var _language = message['language'];
                    if (null != _language) {
                        handleLanguageSet(_language);
                    }

                } else if (message.type == 'forget_wifi') {  // delete current wifi info
                    console.log("connection_service forget wifi ");
                    networkHelper.forgetWifi();
                    configState = null;
                    PageHelper.skipPage(PageHelper.PAGE_STATUS.setup_page);
                    networkHelper.openHotspot(configState);

                    var storeObj = {
                        name: deviceName,
                        code: code,
                        language: language,
                        timezone: timezone
                    };
                    storeData(storeObj);
                }

            } else if (message.command == "query") {  // 'Get' command

                if (message.type == "key_code") {  // key code which will be displayed on TV

                    if (code == null) {
                        code = genKeyCode();
                    }
                    macAddress = message['ap_mac'];
                    PageHelper.setKeyCodeElement(code);

                    console.log(" query key code configState: " + configState);
                    if (configState == null || PageHelper.getCurrentPage() == PageHelper.PAGE_STATUS.reconnect_page || PageHelper.getCurrentPage() == PageHelper.PAGE_STATUS.connectfail_page) {
                        if (apScanTimer != undefined && apScanTimer != null) {
                            console.log("ready to setup dongle?clear auto re-connect timer!");
                            clearInterval(apScanTimer);
                            apScanTimer = undefined;
                            aplastScanDate = 0;
                        }
                        PageHelper.skipPage(PageHelper.PAGE_STATUS.await_page);
                    }

                    var codeMessage = {
                        'command': '~query',
                        'type': 'key_code',
                        'key_code': code
                    };
                    var encodeCodeMessage = ConstantUtils.encode(JSON.stringify(codeMessage));
                    cfdSocket.send(MessageDecoder.ProtocolEncode(JSON.parse(encodeCodeMessage), 'reply', {
                        'reply': false,
                        'task_id': data.meta.task_id
                    }));

                    var storeObj = {
                        apmac: macAddress
                    };
                    updateData(storeObj);

                } else if (message.type == "ap-list") {
                    var task_id = data.meta.task_id;

                    if (networkManager.enabled) {
                        sendNetworks(task_id);
                    } else {
                        sendApNetworks(task_id);
                    }
                } else if (message.type == 'device_info') { // Get current device info
                    if (undefined == language || null == language) {
                        language = "en-US";
                    }

                    var backMessage = {
                        'command': '~query',
                        'type': 'device_info',
                        'macAddress': macAddress,
                        'language': language,
                        'timezone': timezone,
                        'version': deviceVersion
                    };

                    var encodeMsg = ConstantUtils.encode(JSON.stringify(backMessage));
                    cfdSocket.send(MessageDecoder.ProtocolEncode(JSON.parse(encodeMsg), 'reply', {
                        'reply': false,
                        'task_id': data.meta.task_id
                    }));

                }
            }
        }

    }

    /**
     * Ready to open and connect wifi
     *
     * @param ssid
     * @param bssid
     * @param type
     * @param password
     * @param ishidden
     */
    function handleWifiSet(ssid, bssid, type, password, ishidden) {

        scanTimeoutCount = 0;

        var lock = settings.createLock();
        var hotspot = lock.get('tethering.wifi.ssid');

        hotspot.onsuccess = function () {
            console.log('tethering.wifi.ssid: ' + hotspot.result['tethering.wifi.ssid']);

            var castName = hotspot.result['tethering.wifi.ssid'];
            PageHelper.setElement(castName, ssid);
            PageHelper.skipPage(PageHelper.PAGE_STATUS.connect_page);

            if (networkManager.enabled) {
                console.log("enabled:" + ishidden);
                if (networkHelper.isWifiConnected()) {
                    networkHelper.forgetWifi();
                }
                ishidden = networkHelper.fixHidden(ishidden);
                if (ishidden) {
                    connectTimer = setTimeout(handleConnectFailed, CONNECT_TIME_OUT);
                }

                configState = WIFI_CONFIG_STATE.CONFIGURING;
                networkHelper.connectWifi(ssid, bssid, type, password, ishidden);
            } else {
                console.log("else open wifi");
                networkHelper.openWifi();
            }
        };

        hotspot.onerror = function () {
            console.error('An error occured: ');
        };
    }

    /**
     * Set wifi ssid name
     *
     * @param name
     */
    function handleNameSet(name) {
        var request = settings.createLock().set({
            'tethering.wifi.ssid': name
        });
        deviceName = name;
        var storeObj = {
            name: name
        };
        updateData(storeObj);
        notifyNameChanged();
        PageHelper.setElement(name, connectssid);
    }

    /**
     * Set device's time. 
     * Time format: MM dd,yyyy hh:mm:ss
     *
     * @param tm
     */
    function handleTimeSet(tm) {
        console.log("handle time: " + tm);
        
        if (tm == null) {
            console.log("handle time is null.");
            return;
        }

        var createDT = new Date(tm);
        console.log("handle time: set " + createDT);

        var _mozTime = window.navigator.mozTime;
        if (!_mozTime) {
            console.error('Could not get window.navigator.mozTime');
            return;
        }
        _mozTime.set(createDT);
        isTimeSetBySetting = true;
    }

    /**
     * Set device's timezone
     *
     * @param tz
     * @param reload
     */
    function handleTimezoneSet(tz, reload) {
        console.log("handle timezone:" + tz);
        if (tz == "GMT") {
            tz = "Atlantic/Azores";
        }
        if (tz == null || null == tz.match("/")) {
            return;
        }

        timezone = tz;
        var request = settings.createLock().get('time.timezone');
        request.onsuccess = function () {
            var timez = request.result['time.timezone'];
            console.log("handle timezone get:" + timez);
            if (timez != tz) {
                timezoneChanged = true;
                var result = settings.createLock().set({
                    'time.timezone': tz
                });

                result.onsuccess = function () {
                    if (reload) {
                        window.location.reload(true);
                    }
                }
            }
        };

        request.onerror = function () {
            console.error("An error occured: ");
            var set = settings.createLock().set({
                'time.timezone': tz
            });
        };

        var storeObj = {
            timezone: timezone
        };
        updateData(storeObj);
    }

    /**
     * Set current language
     *
     * @param setlanguage
     */
    function handleLanguageSet(setlanguage) {
        language = setlanguage;
        var storeObj = {
            language: language
        };
        updateData(storeObj);

        var request = settings.createLock().set({
            'language.current': language
        });
    }

    /**
     * Let device do recovery(factory reset)
     */
    function handleResetPhone() {
        console.log("handleResetPhone");
        var power = navigator.mozPower;
        if (!power) {
            console.error('Cannot get mozPower');
            return;
        }

        if (!power.factoryReset) {
            console.error('Cannot invoke mozPower.factoryReset()');
            return;
        }

        power.factoryReset();
    }

    /**
     * Let device reboot
     */
    function handleRebootPhone() {
        console.log("handleRebootPhone");
        navigator.mozApps.getSelf().onsuccess = function gotSelf(evt) {
            var app = evt.target.result;
            // If IAC doesn't exist, just bail out.
            if (!app.connect) {
                return;
            }

            app.connect('rebootcomms').then(function (ports) {
                ports.forEach(function (port) {
                    port.postMessage("Reboot-Cast");
                });
            });
        };
    }

    /**
     * Generate key code
     *
     * @returns {string}
     */
    function genKeyCode() {
        var keyCode = '';
        for (var i = 0; i < 2; i++) {
            var iNum = Math.ceil(Math.random() * 9);
            var sChar = String.fromCharCode(Math.ceil(25 * Math.random() + 65));
            keyCode += sChar + iNum;
        }
        console.log("keyCode:" + keyCode);
        return keyCode;
    }

    /**
     * Format network message
     *
     * @param networkaps
     * @returns {*}
     */
    function formatNetworksMessage(networkaps) {
        var count = 0;
        if (null == oldnetworks && null == networkaps) {
            return null;
        }

        var jsonArray = new Array();
        var isLegal = true;
        if (networkaps != null) {
            for (var x = 0; x < networkaps.length; x++) {
                isLegal = true;
                var _ssid = networkaps[x].ssid;
                try {
                    var reg = new RegExp('\\\\x', 'g');
                    _ssid = _ssid.replace(reg, '%');
                    _ssid = decodeURIComponent(_ssid);
                } catch (e) {
                    console.log(e.message);
                    if (_ssid.match('\\\\x')) {
                        isLegal = false;
                    }
                }
                console.log("_ssid_replace:" + _ssid);

                if (isLegal) {
                    var _bssid = networkaps[x].bssid.toString();
                    console.log("format bssid=:" + _bssid);

                    var _security = undefined;
                    if (networkaps[x].security == undefined) {
                        _security = networkaps[x].capabilities[0];
                    } else {
                        _security = networkaps[x].security[0];
                    }
                    console.log("security:" + _security);

                    var jsonObj = {
                        'ssid': _ssid,
                        'bssid': _bssid,
                        'security': _security
                    };
                    jsonArray.push(jsonObj);
                }
            }
        }

        var jsonMessage = {
            'command': "~query",
            'type': "ap-list",
            'networks': jsonArray
        };

        return jsonMessage;
    }

    /**
     * Read current wifi AP scan result file and send info back to iOS.
     *
     * @param task_id
     */
    function sendApNetworks(task_id) {

        var sdcard = navigator.getDeviceStorage('sdcard');
        if (null === sdcard) {
            console.log("get sdcard error");
            return;
        }
        var request = sdcard.get("scan_result.txt");

        request.onsuccess = function () {
            var file = this.result;
            console.log(aplastScanDate + ":" + file.lastModifiedDate);
            if (aplastScanDate == file.lastModifiedDate) {
                return;
            }
            aplastScanDate = file.lastModifiedDate;
            var fileReader = new FileReader();

            fileReader.onload = function (value) {

                var networkaps = parserNetworks(this.result);
                var message = formatNetworksMessage(networkaps);
                if (networkaps != null) {
                    oldnetworks = networkaps;
                }
                if (null != message) {

                    var encodeMsg = ConstantUtils.encode(JSON.stringify(message));
                    cfdSocket.send(MessageDecoder.ProtocolEncode(JSON.parse(encodeMsg), 'reply', {
                        'reply': false,
                        'task_id': task_id
                    }));
                }
            };

            fileReader.readAsText(file);
            console.log("Get the file: " + file.name);
        };

        request.onerror = function () {
            console.warn("Unable to get the file: " + this.error);
        }
    }

    /**
     * Get current wifi networks and send them back to iOS
     *
     * @param task_id
     */
    function sendNetworks(task_id) {

        if (!networkManager.enabled) {
            console.log("networkManager disabled");
            return;
        }

        var reuqest = networkManager.getNetworks();
        reuqest.onsuccess = function () {
            console.log("send networks found:onsuccess");
            var networks = reuqest.result;
            var message = formatNetworksMessage(networks);
            if (networks != null) {
                oldnetworks = networks;
            }
            if (null != message) {
                var encodeMsg = ConstantUtils.encode(JSON.stringify(message));
                cfdSocket.send(MessageDecoder.ProtocolEncode(JSON.parse(encodeMsg), 'reply', {
                    'reply': false,
                    'task_id': task_id
                }));
            }
        };

        reuqest.onerror = function (err) {
            console.log("scan network onerror");
        };
    }

    /**
     * Periodicly (10s) auto open/connect wifi when it's in AP mode.
     *
     * When device entered AP mode, one interval timer will be set to auto connect wifi when wifi is available. we read those wifi info from a file stored on SDCARD.
     * Please note, this file will be created by one native application.
     */
    function handleApNetworks() {
        //console.log("get ap networks!");
        var sdcard = navigator.getDeviceStorage('sdcard');
        if (null === sdcard) {
            console.log("get sdcard error!!!");
            return;
        }

        var request = sdcard.get("scan_result.txt");

        request.onsuccess = function () {
            var file = this.result;
            //console.log(aplastScanDate + ":" + file.lastModifiedDate);
            if (aplastScanDate == file.lastModifiedDate) {
                return;
            }
            aplastScanDate = file.lastModifiedDate;
            var fileReader = new FileReader();

            fileReader.onload = function (value) {
                var networkaps = parserNetworks(this.result);
                var hasSsid = false;
                var _ssid;
                var _bssid;
                var _security;

                console.log("Auto scan: check networks...");

                for (var i in networkaps) {

                    //console.log(networkaps[i].bssid + "-->" + networkaps[i].ssid + "--!");
                    _ssid = networkaps[i].ssid;
                    _bssid = networkaps[i].bssid;
                    _security = networkaps[i].security;

                    if (_bssid && _bssid == bssid
                        && _ssid && _ssid == connectssid
                        && _security && _security == type) {
                        console.log("Auto scan: found:" + bssid);
                        handleWifiSet(connectssid, bssid, type, password, ishidden);
                        return;
                    }
                }
                //console.log("can not found savedBssid");
            };

            fileReader.readAsText(file);
            //console.log("Get the file: " + file.name);
        };

        request.onerror = function () {
            //console.warn("Unable to get the file: " + this.error);
        }
    }

    /**
     * Parse networks string
     *
     * @param networkStr
     * @returns {*} formated networks array
     */
    function parserNetworks(networkStr) {
        var KEY_ADDRESS = "Address:";
        var KEY_SSID = "ESSID:";
        var KEY_ENCRYPTION = "Encryption key:";
        var KEY_IE = "IE:";
        var mac_reg = /[A-F\d]{2}:[A-F\d]{2}:[A-F\d]{2}:[A-F\d]{2}:[A-F\d]{2}:[A-F\d]{2}/;

        var networkaps = new Array();

        var strs = networkStr.split("Cell ");
        if (strs == null) {
            return null;
        }
        for (var i in strs) {
            var _security = "OPEN";
            var _str = strs[i].trim();
            var _mac = _str.match(mac_reg);

            var _startIndex = _str.indexOf(KEY_SSID) + KEY_SSID.length;
            var _endIndex = _str.lastIndexOf("\"");
            var _ssid = _str.substring(_startIndex + 1, _endIndex);

            var _encryptionStartIndex = _str.indexOf(KEY_ENCRYPTION) + KEY_ENCRYPTION.length;
            var _encryptionEndIndex = _str.length;
            var _encryption = _str.substring(_encryptionStartIndex, _encryptionEndIndex);
            //    console.log("_encryption:" + _encryption);

            if (_encryption == "off") {
                _security = "OPEN";
            } else {
                var _IEIndex = _str.indexOf(KEY_IE);
                //        console.log("IE:" + _IEIndex);
                if (_IEIndex == -1) {
                    _security = "WEP";
                } else {
                    var _encryptionIndex = _str.indexOf(KEY_ENCRYPTION);
                    var _IEString = _str.substring(_IEIndex, _encryptionIndex);
                    if (-1 != _IEString.indexOf("WPA")) {
                        _security = "WPA/WPA2 PSK"
                    } else {
                        _security = "WEP"
                    }
                }
            }
            //    console.log("_mac:" + _mac + "-->" + "_ssid:" + _ssid + "-->" + _security);

            if (undefined != _mac && null != _mac) {
                var _networkap = new Object();
                _mac = _mac.toString().toLowerCase();
                _networkap.ssid = _ssid;
                _networkap.bssid = _mac;
                _networkap.security = [_security];
                //        console.log("security:" + _networkap.security[0]);
                networkaps.push(_networkap);
            }
        }

        return networkaps;
    }

    /**
     * Process wifi AP changed events.
     *
     * @param event
     */
    function handleHotspotChange(event) {
        console.log("hotspot_event:" + event.settingName + "-->" + event.settingValue);

        if (event.settingValue == true) { // enable AP mode
            console.log("hotspt changed configState:" + configState);
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (connectTimer) {
                clearTimeout(connectTimer);
                connectTimer = null;
            }

            autoScan = false;
            scanTimeoutCount = 0;
            if (null != configState) {
                if (configState != WIFI_CONFIG_STATE.FAIL) {
                    var openReq = netcastDB.openDb();
                    openReq.onsuccess = function (evt) {
                        netcastDB.setDB(this.result);
                        var i;
                        var dataReq = netcastDB.getStoreData();
                        dataReq.onsuccess = function (evt) {
                            var cursor = evt.target.result;

                            if (cursor) {
                                var value = cursor.value;
                                connectssid = value.ssid;
                                bssid = value.bssid;
                                password = value.password;
                                type = value.type;
                                var hidden = value.hidden;
                                ishidden = networkHelper.fixHidden(hidden);
                                configState = value.state;
                                cursor.continue();
                                i++;
                            } else {
                                netcastDB.closeDB();
                                if (apScanTimer == null) {
                                    console.log("start ap scan timer!!!");
                                    apScanTimer = setInterval(handleApNetworks, 20000); // start auto-connect wifi timer.
                                }
                                console.log("No more entries!!!");
                            }
                        };
                    };
                    openReq.onerror = function (evt) {
                        console.error("openDb:", evt.target.errorCode);
                    };
                }
            } else {
                console.log("not config success");
            }
        } else {  // disable AP event
            if (apScanTimer != undefined && apScanTimer != null) {
                clearInterval(apScanTimer);
                apScanTimer = undefined;
                aplastScanDate = 0;
            }
            console.log("handle HotspotChange close ap");
        }
    }

    /**
     * Store current wifi config state(WIFI_CONFIG_STATE.SUCCESS,etc)
     *
     * @param state
     */
    function storeConfigState(state) {
        var storeObj = {
            state: state
        };
        updateData(storeObj);
    }

    /**
     * Enter AP mode when re-connect timeout event happens
     */
    function reconnectTimeout() {
        console.log("reconnect time out");
        networkHelper.openHotspot(configState);
    }

    /**
     * When we get 'connectingfailed' wifi event, we will enter AP mode.
     */
    function handleConnectFailed() {
        console.log("handleConnectFailed configState:" + configState);
        if (!bssid || !connectssid) {
            configState = WIFI_CONFIG_STATE.FAIL;
            networkHelper.openHotspot(configState);
            storeConfigState(configState);
            return;
        }

        if (ishidden || configState == WIFI_CONFIG_STATE.CONFIGURING) {
            configState = WIFI_CONFIG_STATE.FAIL;
            networkHelper.openHotspot(configState);
            storeConfigState(configState);
            return;
        }

        var scanTimeouter = setTimeout(function () {
            configState = WIFI_CONFIG_STATE.FAIL;
            networkHelper.openHotspot(configState);
            storeConfigState(configState);
        }, 5000);

        var reuqest = networkManager.getNetworks();
        reuqest.onsuccess = function () {
            console.log("network_find_count:onsuccess");
            clearTimeout(scanTimeouter);
            var networks = reuqest.result;
            var _network = undefined;

            for (var index = 0; index < networks.length ; index++) {
                console.log(networks[index].bssid + ":" + networks[index].ssid);
                if (bssid == networks[index].bssid && connectssid == networks[index].ssid) {
                    _network = networks[index];
                    break;
                }
            }

            if (_network != undefined && _network != null) {
                configState = WIFI_CONFIG_STATE.FAIL;
            } else {
                configState = WIFI_CONFIG_STATE.DISCONNECT;
            }
            storeConfigState(configState);
            networkHelper.openHotspot(configState);
        };

        reuqest.onerror = function (err) {
            console.log("scan network onerror" + network_find_count);
            clearTimeout(scanTimeouter);
            if (network_find_count < NETWORK_MAX_FIND) {
                window.setTimeout(handleConnectFailed, 2000);
                network_find_count++;

            } else {
                configState = WIFI_CONFIG_STATE.DISCONNECT;
                networkHelper.openHotspot(configState);
                storeConfigState(configState);
            }
        };

    }

    /**
     * Get network's security mode
     *
     * @param network
     * @returns {*}
     */
    function getSecurity(network) {
        var security = null;
        if (network.security === undefined) {
            security = network.capabilities[0];
        } else {
            security = network.security[0];
        }
        return security;
    }

    /**
     * When wifi is enabled, let device connect to it. when network info is empty or error happens, let device enter AP mode.
     */
    function initConnectWifi() {
        var scanTimeouter = setTimeout(function () {
            autoScan = true;
            isInit = false;
            networkHelper.closeWifi();
        }, 5000);

        var reuqest = networkManager.getNetworks();
        reuqest.onsuccess = function () {
            console.log("network_find_count:onsuccess");
            clearTimeout(scanTimeouter);
            if (networkHelper.isWifiConnected()) {
                scaning = false;
                return;
            }
            var networks = reuqest.result;
            var _network = undefined;
            var _security = undefined;
            var _type = undefined;
            if (type) {
                _type = networkHelper.fixSecurity(type);
            }

            for (var index = 0; index < networks.length; index++) {
                _security = getSecurity(networks[index]);
                //    console.log("_type:" + _type);
                //    console.log(networks[index].bssid + ":" + networks[index].ssid + ":" + _security);
                if (bssid && bssid == networks[index].bssid
                    && connectssid && connectssid == networks[index].ssid
                    && _type && _type == _security) {
                    _network = networks[index];
                    break;
                }
            }

            if (_network != undefined && _network != null) {
                console.log("init connect wifi:" + _network.ssid);
                ishidden = networkHelper.fixHidden(ishidden);
                if (ishidden) {
                    connectTimer = setTimeout(handleConnectFailed, CONNECT_TIME_OUT);
                }
                configState = WIFI_CONFIG_STATE.CONFIGURING;
                networkHelper.connectWifi(connectssid, bssid, type, password, ishidden);
                PageHelper.skipPage(PageHelper.PAGE_STATUS.connect_page);
            } else {
                console.log("init connect wifi null");
                configState = WIFI_CONFIG_STATE.DISCONNECT;
                networkHelper.openHotspot(configState);
            }
            scaning = false;
        };

        reuqest.onerror = function (err) {
            console.log("scan network onerror");
            clearTimeout(scanTimeouter);
            if (networkHelper.isWifiConnected()) {
                scaning = false;
                return;
            }
            if (network_find_count < NETWORK_MAX_FIND) {
                window.setTimeout(initConnectWifi, 5000);
                network_find_count++;

            } else {
                configState = WIFI_CONFIG_STATE.DISCONNECT;
                networkHelper.openHotspot(configState);
            }
            scaning = false;
        };
    }

    /**
     * Store configuration data (wifi info, timezone,etc)
     *
     * @param obj
     */
    function storeData(obj) {
        var openReq = netcastDB.openDb();
        openReq.onsuccess = function (evt) {
            console.log("updateData");
            netcastDB.setDB(this.result);
            netcastDB.clearStoreData();
            netcastDB.storeData(obj)
        };
        openReq.onerror = function (evt) {
            storeData(obj);
            console.error("openDb:", evt.target.errorCode);
        };
    }

    /**
     * Update configuration data.
     *
     * @param obj
     */
    function updateData(obj) {
        var openReq = netcastDB.openDb();
        openReq.onsuccess = function (evt) {
            console.log("updateData");
            netcastDB.setDB(this.result);
            netcastDB.updateData(obj);
        };
        openReq.onerror = function (evt) {
            updateData(obj);
            console.error("openDb:", evt.target.errorCode);
        };
    }

    /**
     * Check and update current config information.
     *
     * @param castName device name(ssid)
     */
    function checkConfigInfo(castName) {
        console.log("device state:" + configState);
        if (!configState) {
            return;
        }

        if (!deviceName) {
            return;
        }
        var _deviceName = deviceName.trim();
        console.log("device name:" + "->" + typeof(deviceName) + "->" + deviceName + "->" + castName);
        if (!_deviceName || deviceName != castName) {
            deviceName = castName;
            console.log("device name:" + deviceName + "->" + castName);
        }

        if (!code) {
            return;
        }
        var _code = code.trim();
        console.log("device code:" + code + typeof(code));
        if (!_code) {
            code = genKeyCode();
            console.log("device code:" + code);
        }

        if (!timezone) {
            return;
        }
        var _timezone = timezone.trim();
        console.log("device timezone:" + timezone + "->" + typeof(timezone));
        if (!_timezone) {
            console.log("device timezone:" + timezone);
            var treq = settings.createLock().get('time.timezone');
            treq.onsuccess = function () {
                timezone = treq.result['time.timezone'];
                console.log("device timezone:" + timezone);
            }
        }

        if (!language) {
            return;
        }
        var _language = language.trim();
        console.log("device language:" + language + "->" + typeof(language));
        if (!_language) {
            var lreq = settings.createLock().get('language.current');
            lreq.onsuccess = function () {
                language = lreq.result['language.current'];
                console.log("device language:" + language);
            }
        }

        if (!connectssid || !bssid) {
            return;
        }
        var _connectssid = connectssid.trim();
        var _bssid = bssid.trim();
        console.log("device ssid:" + connectssid + "->" + bssid);
        console.log("device ssid typeof:" + typeof(connectssid) + "->" + typeof(bssid));
        if (!_connectssid || !_bssid) {
            connectssid = null;
        }
    }

    /**
     * Init device state
     *
     * 1. When it's a fresh device, set device's SSID name/type and let it enter AP mode. So user can setup it.
     * 2. When it's already configured, init/open wifi and connect to it.
     *
     * Only called once when js loaded
     */
    function initNetcast() {

        var lock = settings.createLock();
        var hotspot = lock.get('tethering.wifi.ssid');

        hotspot.onsuccess = function () {

            console.log('tethering.wifi.ssid: ' + hotspot.result['tethering.wifi.ssid']);
            var castName = hotspot.result['tethering.wifi.ssid'];
            checkConfigInfo(castName);
            console.log("initNetcast configState:" + configState + ":" + connectssid);

            if (null == configState) {

                if (null == deviceName) {
                    var num = "";
                    for (var i = 0; i < 4; i++) {
                        num += Math.floor(Math.random() * 10);
                    }
                    castName = 'MatchStick' + num;
                    console.log("castName:" + castName);

                    var name = settings.createLock().set({
                        'tethering.wifi.ssid': castName
                    });

                    var type = settings.createLock().set({
                        'tethering.wifi.security.type': 'open'
                    });

                    handleTimezoneSet("Asia/Shanghai", false);
                    code = genKeyCode();
                    var storeObj = {
                        name: castName,
                        code: code,
                        timezone: 'Asia/Shanghai'
                    };
                    storeData(storeObj);
                }

                networkHelper.openHotspot(configState);
                PageHelper.skipPage(PageHelper.PAGE_STATUS.setup_page);

            } else {
                if (null == connectssid) {
                    var request = networkManager.getKnownNetworks();

                    request.onsuccess = function () {
                        var networks = this.result;

                        networks.forEach(function (network) {
                            console.log("forEach:" + network.ssid);
                            networkManager.forget(network);
                        });

                        configState = null;
                        networkHelper.openHotspot(configState);
                        PageHelper.skipPage(PageHelper.PAGE_STATUS.setup_page);
                    };

                    request.onerror = function () {
                        console.log("connectingfail forget wifi onerror");
                        configState = null;
                        networkHelper.openHotspot(configState);
                        PageHelper.skipPage(PageHelper.PAGE_STATUS.setup_page);
                    };

                } else {
                    if (!networkManager.enabled) {
                        console.log("initNetcast: openWifi");
                        isInit = true;
                        networkHelper.openWifi();
                        PageHelper.skipPage(PageHelper.PAGE_STATUS.connect_page);
                    } else {
                        var connection = networkManager.connection;

                        if (null != connection && connection != undefined) {

                            console.log("connection:" + connection.status);
                            if (null != connection.status && connection.status != undefined) {

                                if (connection.status == 'connected') {
                                    configState = WIFI_CONFIG_STATE.SUCCESS;
                                    storeConfigState(WIFI_CONFIG_STATE.SUCCESS);
                                    PageHelper.skipPage(PageHelper.PAGE_STATUS.ready_page);

                                } else if (connection.status == 'associated'
                                    || connection.status == 'connecting') {
                                    PageHelper.skipPage(PageHelper.PAGE_STATUS.connect_page);

                                } else {
                                    initConnectWifi();
                                }

                            } else {
                                initConnectWifi();
                            }

                        } else {
                            initConnectWifi();
                        }
                    }
                }
            }
            PageHelper.setKeyCodeElement(code);
            PageHelper.setElement(castName, connectssid);
        };

        hotspot.onerror = function () {
            console.error("An error occured: ");
        };
    }

    /**
     * Init configuration data from DB data
     *
     * when all config information loaded from DB, let device connect wifi or enter AP mode.
     *
     * Only called once when js loaded
     */
    function initData() {
        var openReq = netcastDB.openDb();
        openReq.onsuccess = function (evt) {
            console.log("openDb DONE");
            netcastDB.setDB(this.result);
            (function getData() {
                console.log("get data");
                var i;
                var dataReq = netcastDB.getStoreData();
                dataReq.onsuccess = function (evt) {
                    var cursor = evt.target.result;

                    if (cursor) {
                        var value = cursor.value;
                        deviceName = value.name;
                        code = value.code;
                        macAddress = value.apmac;
                        timezone = value.timezone;
                        language = value.language;
                        connectssid = value.ssid;
                        bssid = value.bssid;
                        password = value.password;
                        type = value.type;
                        ishidden = value.hidden;
                        configState = value.state;
                        cursor.continue();
                        i++;

                        notifyNameChanged();
                    } else {
                        netcastDB.closeDB();
                        initNetcast();
                        console.log("No more entries!");
                    }
                };

                dataReq.onerror = function (evt) {
                    getData();
                    console.error("getData:", evt.target.errorCode);
                };
            }());
        };
        openReq.onerror = function (evt) {
            initData();
            console.error("openDb:", evt.target.errorCode);
        }
    }

    /**
     * Init HTML's font
     *
     * Only called once when js loaded
     */
    function fontInit() {
        var width = document.documentElement.clientWidth;
        var height = document.documentElement.clientHeight;
        var body = document.body;
        var availSize = Math.max(width, height);
        if (availSize < 1024) {
            body.style.fontSize = "12px";
        } else if (availSize == 1024) {
            body.style.fontSize = "16px";
        } else {
            body.style.fontSize = "24px";
        }
    }

    /**
     * Main entry.
     *
     * Init all staff.
     * 1. monitor network status change events(enabled, disabled, status changed)
     * 2. init data (wifi, db, font,etc).
     * 3. init configd client
     *
     * Only called once when js loaded
     */
    function init() {

        networkManager.onenabled = function () {

            console.log("networkManager enabled autoScan:" + autoScan);
            autoScan = true;
            console.log("networkManager enabled isConnected:" + networkHelper.isWifiConnected());
            if (!networkHelper.isWifiConnected()) {
                if (isInit) {
                    isInit = false;
                    initConnectWifi();
                } else {
                    ishidden = networkHelper.fixHidden(ishidden);
                    if (ishidden) {
                        connectTimer = setTimeout(handleConnectFailed, CONNECT_TIME_OUT);
                    }
                    configState = WIFI_CONFIG_STATE.CONFIGURING;
                    networkHelper.connectWifi(connectssid, bssid, type, password, ishidden);
                }
            }
        };

        networkManager.ondisabled = function () {
            console.log("networkManager disabled autoScan:" + autoScan);
            if (autoScan) {
                autoScan = false;
                if (scanTimeoutCount >= SCAN_TIME_OUT_COUNT) {
                    scanTimeoutCount = 0;
                    networkHelper.openHotspot(configState);
                    return;
                }
                scanTimeoutCount++;
                networkHelper.openWifi();
            }
        };

        networkManager.onstatuschange = function (event) {

            console.log('The connection status is: ' + event.status + ":" + configState + ":" + connectssid);

            if (event.status == 'connected') {

                autoScan = false;
                if (reconnectTimer != undefined) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = undefined;
                }
                if (connectTimer != undefined) {
                    clearTimeout(connectTimer);
                    connectTimer = undefined;
                }

                configState = WIFI_CONFIG_STATE.SUCCESS;

                console.log("storage success");
                var _network = event.network;
                var _bssid = _network.bssid;
                if (bssid === null) {
                    bssid = _bssid;
                }

                var wifi_ssid;
                if (event.network != undefined && event.network != null) {
                    wifi_ssid = event.network.ssid;
                }
                console.log("wifi ssid:" + wifi_ssid);
                if (wifi_ssid && wifi_ssid != 'null' && wifi_ssid != connectssid) {
                    connectssid = wifi_ssid;
                }

                console.log("store db success:" + connectssid + "->" + _network.ssid);
                console.log("saved bssid:" + bssid + "->" + _bssid);

                var forgetRequest = networkManager.getKnownNetworks();
                forgetRequest.onsuccess = function () {
                    var networks = this.result;

                    networks.forEach(function (network) {
                        console.log("forEach:" + network.ssid + "-->" + network.bssid);
                        if (network.ssid != connectssid) {
                            networkManager.forget(network);
                        }
                    });
                };

                var storeObj = {
                    ssid: connectssid,
                    bssid: bssid,
                    password: password,
                    type: type,
                    hidden: ishidden,
                    state: configState
                };
                updateData(storeObj);

                PageHelper.setElement(deviceName, connectssid);
                setTimeout(function () {
                    PageHelper.skipPage(PageHelper.PAGE_STATUS.ready_page);
                }, 1000);

            } else if (event.status == 'connectingfailed' && networkManager.enabled) {

                autoScan = false;
                if (null != reconnectTimer && reconnectTimer != undefined) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                if (null != connectTimer && connectTimer != undefined) {
                    clearTimeout(connectTimer);
                    connectTimer = null;
                }

                settings.createLock().set({'wifi.connect_via_settings': false});

                var request = networkManager.getKnownNetworks();

                request.onsuccess = function () {
                    var networks = this.result;
                    var _ssid;
                    var openReq = netcastDB.openDb();
                    openReq.onsuccess = function (evt) {
                        console.log("updateData");
                        netcastDB.setDB(this.result);
                        var i;
                        var dataReq = netcastDB.getStoreData();
                        dataReq.onsuccess = function (evt) {
                            var cursor = evt.target.result;

                            if (cursor) {
                                console.log("cursor key:" + cursor.key);
                                var value = cursor.value;
                                for (var x in value) {
                                    console.log(x + "==" + value[x]);
                                }
                                _ssid = value.ssid;
                                cursor.continue();
                                i++;
                            } else {
                                netcastDB.closeDB();
                                console.log("No more entries");
                            }

                            networks.forEach(function (network) {
                                console.log("forEach:" + network.ssid + "->" + network.bssid);
                                if (network.ssid != _ssid) {
                                    networkManager.forget(network);
                                }
                            });
                        };
                    };

                    network_find_count = 0;
                    handleConnectFailed();
                };

                request.onerror = function () {
                    console.log("connectingfail forget wifi onerror");
                    network_find_count = 0;
                    handleConnectFailed();
                };

            } else if (event.status == 'associated' || event.status == 'connecting') {
                autoScan = false;
                if (null != reconnectTimer && reconnectTimer != undefined) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                if (null != connectTimer && connectTimer != undefined) {
                    clearTimeout(connectTimer);
                    connectTimer = null;
                }
            } else if (event.status == 'disconnected' && networkManager.enabled) {

                console.log("The connection disconnected" + networkManager.enabled);
                if (configState == WIFI_CONFIG_STATE.SUCCESS) {
                    configState = WIFI_CONFIG_STATE.DISCONNECT;
                    PageHelper.skipPage(PageHelper.PAGE_STATUS.connect_page);
                    reconnectTimer = window.setTimeout(reconnectTimeout, 10000);
                    storeConfigState(configState);
                } else if (configState == WIFI_CONFIG_STATE.DISCONNECT) {
                    console.log("disconnected network manager:" + networkManager.enabled);
                    storeConfigState(configState);
                    if (null != reconnectTimer && reconnectTimer != undefined) {
                        clearTimeout(reconnectTimer);
                    }
                    reconnectTimer = window.setTimeout(reconnectTimeout, 8000);
                }
            }
            PageHelper.checkWifiStatus();
        };

        initData();
        fontInit();
        ConnectConfigDaemon();
        flingUtils.init();
    }

    init();

    return {
        setDeviceVersion : function(ver) {
            deviceVersion = ver;
        },
        getDevicesStatus: function () {
          var message = JSON.stringify({
            'type': 'SYSTEM_STATUS',
            'name': deviceName,
            'ssid': connectssid,
            'requestId': generateRequestID()
          });
          return ConstantUtils.encode(message);
        }
    };
})();
