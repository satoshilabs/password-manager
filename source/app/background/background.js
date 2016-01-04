'use strict';

let PHASE = 'DROPBOX', /* DROPBOX, TREZOR, LOADED */
    Buffer = require('buffer/').Buffer,
    crypto = require('crypto'),

// GENERAL STUFF

    basicObjectBlob = {
        'tags': {
            '0': {
                'title': 'All',
                'icon': 'home'
            }
        },
        'entries': {}
    },

    badgeState = {
        loaded: {color: [59, 192, 195, 100], defaultText: '\u0020'},
        waiting: {color: [237, 199, 85, 100], defaultText: '\u0020'},
        disconnected: {color: [237, 199, 85, 100], defaultText: '\u0020'},
        throttled: {color: [255, 255, 0, 100], defaultText: '!'}
    },

    updateBadgeStatus = (status) => {
        chrome.browserAction.setBadgeText({text: badgeState[status].defaultText});
        chrome.browserAction.setBadgeBackgroundColor(
            {color: badgeState[status].color});
    },

    sendMessage = (msgType, msgContent) => {
        chrome.runtime.sendMessage({type: msgType, content: msgContent});
    },

    init = () => {
        switch (PHASE) {
            case 'LOADED':
                loadFile();
                break;
            case 'DROPBOX':
                if (dropboxUsername !== '') {
                    setDropboxUsername();
                }
                break;
            case 'TREZOR':
                if (trezorKey === '') {
                    connectTrezor();
                } else {
                    PHASE = 'LOADED'
                }
                break;
        }
    },

    toArrayBuffer = (buffer) => {
        let ab = new ArrayBuffer(buffer.length),
            view = new Uint8Array(ab);
        for (var i = 0; i < buffer.length; ++i) {
            view[i] = buffer[i];
        }
        return ab;
    },

    toBuffer = (ab) => {
        let buffer = new Buffer(ab.byteLength),
            view = new Uint8Array(ab);
        for (var i = 0; i < buffer.length; ++i) {
            buffer[i] = view[i];
        }
        return buffer;
    },

    toHex = (pwd)  => {
        try {
            let result = new Buffer(pwd, 'utf8').toString('hex'),
                check = new Buffer(result, 'hex').toString('utf8');
            if (check === pwd) {
                return result;
            } else {
                // fix later!
                throw new Error('Whoops!');
            }
        } catch (error) {
            console.log(error);
        }
    },

    fromHex = (hex) => {
        try {
            let pwd = new Buffer(hex, 'hex').toString('utf8'),
                check = new Buffer(pwd, 'utf8').toString('hex');
            if (hex === check) {
                return pwd;
            } else {
                // fix later!
                throw new Error('Whoops!');
            }
        } catch (error) {
            console.log(error);
        }
    },

    addPaddingTail = (hex) => {
        let paddingNumber = 16 - (hex.length % 16),
            tail = new Array(paddingNumber + 1).join((paddingNumber - 1).toString(16));
        return hex + tail;
    },

    removePaddingTail = (hex) => {
        let paddingNumber = parseInt(hex.charAt(hex.length - 1), 16) + 1;
        return hex.slice(0, -paddingNumber);
    };


// DROPBOX PHASE

const FILENAME_MESS = 'deadbeeffaceb00cc0ffee00fee1deadbaddeadbeeffaceb00cc0ffee00fee1e';

let dropboxClient = {},
    dropboxUsername = '',
    dropboxUsernameAccepted = false,
    dropboxUid = {},
    FILENAME = false,

    handleDropboxError = (error) => {
        switch (error.status) {
            case Dropbox.ApiError.INVALID_TOKEN:
                console.warn('User token expired ', error.status);
                sendMessage('errorMsg', 'Dropbox User token expired');
                break;

            case Dropbox.ApiError.NOT_FOUND:
                console.warn('File or dir not found ', error.status);
                encryptData(basicObjectBlob);
                break;

            case Dropbox.ApiError.OVER_QUOTA:
                console.warn('Dropbox quota overreached ', error.status);
                sendMessage('errorMsg', 'Dropbox quota overreached.');
                break;

            case Dropbox.ApiError.RATE_LIMITED:
                console.warn('Too many API calls ', error.status);
                sendMessage('errorMsg', 'Too many Dropbox API calls.');
                break;

            case Dropbox.ApiError.NETWORK_ERROR:
                console.warn('Network error, check connection ', error.status);
                sendMessage('errorMsg', 'Dropbox Network error, check connection.');
                break;

            case Dropbox.ApiError.INVALID_PARAM:
            case Dropbox.ApiError.OAUTH_ERROR:
            case Dropbox.ApiError.INVALID_METHOD:
            default:
                console.warn('Network error, check connection ', error.status);
                sendMessage('errorMsg', 'Network error, check connection.');
        }
    },

    connectToDropbox = () => {
        dropboxClient = new Dropbox.Client({key: 'k1qq2saf035rn7c'});
        dropboxClient.authDriver(new Dropbox.AuthDriver.ChromeExtension({receiverPath: '/html/chrome_oauth_receiver.html'}));
        dropboxClient.onError.addListener(function (error) {
            handleDropboxError(error);
        });
        dropboxClient.authenticate((error, data) => {
            if (error) {
                return handleDropboxError(error);
            } else {
                if (dropboxClient.isAuthenticated()) {
                    setDropboxUsername();
                    sendMessage('dropboxConnected');
                }
            }
        });
    },

    setDropboxUsername = () => {
        dropboxClient.getAccountInfo(function (error, accountInfo) {
            if (error) {
                handleDropboxError(error);
                connectToDropbox();
            }
            dropboxUsername = accountInfo.name;
            dropboxUid = accountInfo.uid;
            trezorDevice = null;
            deviceList = null;
            sendMessage('setDropboxUsername', accountInfo.name);
        });
    },

    signOutDropbox = () => {
        dropboxClient.signOut(function (error, accountInfo) {
            if (error) {
                handleDropboxError(error);
            }
            sendMessage('dropboxDisconnected');
            dropboxClient = {};
            dropboxUsername = '';
            dropboxUsernameAccepted = false;
            PHASE = 'DROPBOX';
        });
    },

    loadFile = () => {
        try {
            // creating filename
            if (!FILENAME) {
                let key = fullKey.toString('utf8').substring(0, fullKey.length / 2);
                FILENAME = crypto.createHmac('sha256', key).update(dropboxUid + FILENAME_MESS).digest('hex') + '.txt';
            }
            dropboxClient.readFile(FILENAME, {arrayBuffer: true}, (error, data) => {
                if (error) {
                    return handleDropboxError(error);
                } else {
                    var res = toBuffer(data);
                    if (!(Buffer.isBuffer(res))) {
                        reject("Not a buffer");
                    }
                    decryptData(res);
                }
            });
        } catch (err) {

        }
    },

    saveFile = (data) => {
        dropboxClient.writeFile(FILENAME, toArrayBuffer(data), function (error, stat) {
            if (error) {
                return handleDropboxError(error);
            } else {
                loadFile();
            }
        });
    };

// TREZOR PHASE

const HD_HARDENED = 0x80000000,
    ENC_KEY = 'Activate TREZOR Guard?',
    ENC_VALUE = 'deadbeec1cada53301f001edc1a551f1edc0de51111ea11c1afee1fee1fade51',
    CIPHER_IVSIZE = 96 / 8,
    AUTH_SIZE = 128 / 8,
    CIPHER_TYPE = 'aes-256-gcm';

let deviceList = null,
    trezorDevice = null,
    fullKey = '',
    encryptionKey = '',
    displayPhrase = (title, username) => {return 'Unlock ' + title + ' under ' + username + ' username?'},
    handleTrezorError = (error) => {
        console.log('error happend! ', error);
        switch (error) {
            case NO_TRANSPORT:
                break;

            case DEVICE_IS_EMPTY:
                break;

            case FIRMWARE_IS_OLD:
                break;

            case NO_CONNECTED_DEVICES:
                break;

            case DEVICE_IS_BOOTLOADER:
                break;

            case INSUFFICIENT_FUNDS:
                break;
        }
        switch (error.code) {
            case 'Failure_PinInvalid':
                console.log('wrong pin!');
                break;
        }
    },

    connectTrezor = () => {
        deviceList = new trezor.DeviceList();
        deviceList.on('connect', initTrezorDevice);
        deviceList.on('error', (error) => {
            console.error('List error:', error);
        });
    },

    initTrezorDevice = (device) => {
        try {
            trezorDevice = device;
            sendMessage('trezorConnected');
            trezorDevice.on('pin', pinCallback);
            trezorDevice.on('passphrase', passphraseCallback);
            trezorDevice.on('button', buttonCallback);
            trezorDevice.on('disconnect', disconnectCallback);
            if (trezorDevice.isBootloader()) {
                throw new Error('Device is in bootloader mode, re-connected it');
            }
            trezorDevice.session.cipherKeyValue(getPath(), ENC_KEY, ENC_VALUE, true, true, true).then((result) => {
                fullKey = result.message.value;
                encryptionKey = fullKey.toString('utf8').substring(fullKey.length / 2, fullKey.length);
                loadFile();
            });
        } catch (error) {
            console.error('Device error:', error);
        }

    },

    encryptData = (data) => {
        randomInputVector().then((iv) => {
            let stringified = JSON.stringify(data),
                buffer = new Buffer(stringified, 'utf8'),
                cipher = crypto.createCipheriv(CIPHER_TYPE, encryptionKey, iv),
                startCText = cipher.update(buffer),
                endCText = cipher.final(),
                auth_tag = cipher.getAuthTag();
            saveFile(Buffer.concat([iv, auth_tag, startCText, endCText]));
        });
    },

    decryptData = (data) => {
        let iv = data.slice(0, CIPHER_IVSIZE),
            auth_tag = data.slice(CIPHER_IVSIZE, CIPHER_IVSIZE + AUTH_SIZE),
            cText = data.slice(CIPHER_IVSIZE + AUTH_SIZE),
            decipher = crypto.createDecipheriv(CIPHER_TYPE, encryptionKey, iv),
            start = decipher.update(cText);
        decipher.setAuthTag(auth_tag);
        let end = decipher.final(),
            res = Buffer.concat([start, end]),
            stringifiedContent = res.toString('utf8');
        sendMessage('decryptedContent', stringifiedContent);
        PHASE = 'LOADED';
    },

    encryptEntry = (data, callback) => {
        let key = displayPhrase(data.title, data.username),
            tailedHex = toHex(addPaddingTail(toHex(data.password)));
        trezorDevice.session.cipherKeyValue(getPath(), key, tailedHex, true, false, true).then((result) => {
            callback({content: result.message.value});
        });
    },

    decryptEntry = (data, callback) => {
        let key = displayPhrase(data.title, data.username);
        trezorDevice.session.cipherKeyValue(getPath(), key, data.password, false, false, true).then((result) => {
            callback({content: fromHex(removePaddingTail(fromHex(result.message.value)))});
        });
    },

// FIX ME down here! (hint: make nice hardended path:)
    getPath = () => {
        return [(1047 | HD_HARDENED) >>> 0, (1047 | HD_HARDENED) >>> 0, 0]
    },

    pinCallback = (type, callback) => {
        trezorDevice.pinCallback = callback;
        sendMessage('showPinDialog');
    },

    pinEnter = (pin) => {
        trezorDevice.pinCallback(null, pin);
    },

    passphraseCallback = (callback) => {
        callback(null, '');
    },

    buttonCallback = (type, callback) => {
        sendMessage('showButtonDialog');
        trezorDevice.buttonCallback = callback;
    },

    buttonEnter = (code) => {
        trezorDevice.buttonCallback(null, code);
    },

    disconnectCallback = () => {
        trezorDevice.removeListener('pin', pinCallback);
        trezorDevice.removeListener('passphrase', passphraseCallback);
        trezorDevice.removeListener('button', buttonCallback);
        trezorDevice.removeListener('disconnect', disconnectCallback);
        trezorDevice = {};
        deviceList.removeListener('connect', initTrezorDevice);
        deviceList = {};
        dropboxUsernameAccepted = false;
        sendMessage('trezorDisconnected');
        PHASE = 'DROPBOX';
        init();
    },

    randomInputVector = () => {
        return new Promise((resolve, reject) => {
            try {
                crypto.randomBytes(CIPHER_IVSIZE, (err, buf) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(buf);
                    }
                })
            } catch (err) {
                reject(err);
            }
        })
    };


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {

        case 'initPlease':
            init();
            break;

        case 'connectDropbox':
            connectToDropbox();
            break;

        case 'initTrezorPhase':
            dropboxUsernameAccepted = true;
            sendMessage('trezorDisconnected');
            connectTrezor();
            break;

        case 'trezorPin':
            pinEnter(request.content);
            break;

        case 'trezorPassphrase':
            passphrasEnter(request.content);
            break;

        case 'disconnectDropbox':
            signOutDropbox();
            break;

        case 'loadContent':
            loadFile();
            break;

        case 'saveContent':
            encryptData(request.content);
            break;

        case 'encryptPassword':
            encryptEntry(request.content, sendResponse);
            break;

        case 'decryptPassword':
            decryptEntry(request.content, sendResponse);
            break;
    }
    return true;
});

