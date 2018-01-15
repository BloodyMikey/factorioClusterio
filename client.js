bootStart = Date.now()

const fs = require('fs-extra');
const https = require('follow-redirects').https;
const needle = require("needle");
const needleReqOptions = {
	rejectUnauthorized: false  // verify SSL certificate
}
const child_process = require('child_process');
const path = require('path');
const syncRequest = require('sync-request');
const request = require("request");
const ncp = require('ncp').ncp;
const Rcon = require('simple-rcon');
const hashFiles = require('hash-files');
const _ = require('underscore');
const deepmerge = require("deepmerge");
const getMac = require('getmac').getMac;
const rmdirSync = require('rmdir-sync');
// internal libraries
const objectOps = require("./lib/objectOps.js");
const fileOps = require("./lib/fileOps.js");
const stringUtils = require("./lib/stringUtils.js");
const modManager = require("./lib/manager/modManager.js");
const configManager = require("./lib/manager/configManager.js");

// require config.json
var config = require('./config');
var global = {};

bootEnd = Date.now()

console.log("Started in "+(bootEnd-bootStart)+" ms");

if (!fs.existsSync("./instances/")) {
	fs.mkdirSync("instances");
}
if (!fs.existsSync("./sharedPlugins/")) {
	fs.mkdirSync("sharedPlugins");
}
if (!fs.existsSync("./sharedMods/")) {
	fs.mkdirSync("sharedMods");
}
const instance = process.argv[3];
const instancedirectory = './instances/' + instance;
const command = process.argv[2];

// Set the process title, shows up as the title of the CMD window on windows
// and as the process name in ps/top on linux.
process.title = "clusterioClient "+instance;

var instanceInfo = {};

// function to handle sending commands into the game
function messageInterface(command, callback) {
	// try to save us if you send a buffer instead of string
	if(typeof command == "object") {
		command = command.toString('utf8');
	}
	
	if(process.platform == "linux" && typeof command == "string" && serverprocess) {
		/*
			to send to stdin, use:
			serverprocess.stdin.write("/c command;\n")
		*/
		serverprocess.stdin.write(command+"\n");
		if(typeof callback == "function"){
			callback();
		}
	} else if(typeof command == "string" && client && client.exec && typeof client.exec == "function") {
		try {
			client.exec(command+"\n", callback);
		} catch (err) {
			console.log(err);
		}
		if(typeof callback == "function"){
			callback();
		}
	}
}

// handle commandline parameters
if (!command || command == "help" || command == "--help") {
	console.error("Usage: ");
	console.error("node client.js start [instance name]");
	console.error("node client.js list");
	console.error("node client.js delete [instance]");
	console.error("To download the latest version of the Clusterio lua mod, do");
	console.error("node client.js manage shared mods download clusterio");
	console.error("For more management options, do");
	console.error("node client.js manage");
	process.exit(1);
} else if (command == "list") {
	let instanceNames = fileOps.getDirectoriesSync("./instances/");
	instanceNames.unshift("Name:");
	let longestInstanceName = 0;
	// determine longest instance name
	instanceNames.forEach(function(instance){
		if(instance.length > longestInstanceName) longestInstanceName = instance.length;
	});
	let displayLines = [];
	// push name coloumn to array
	instanceNames.forEach(function(instance){
		while(instance.length < longestInstanceName+1){
			instance += " ";
		}
		displayLines.push("| "+ instance + "|");
	});
	// create port colloumn
	let factorioPorts = [];
	instanceNames.forEach(function(instance){
		let factorioPort
		
		if(instance.includes("Name:")){
			factorioPort = "Port:"
		} else {
			factorioPort = require("./instances/"+instance+"/config").factorioPort;
		}
		factorioPorts.push(factorioPort);
	});
	factorioPorts.forEach((port, index) => {
		let longestPort = 0;
		factorioPorts.forEach((port, index) => {
			if(port.toString().length > longestPort) longestPort = port.toString().length;
		});
		while(port.toString().length < longestPort){
			port += " ";
		}
		factorioPorts[index] = port;
	});
	instanceNames.forEach(function(instance, index){
		displayLines[index] += " " + factorioPorts[index] + " |";
	});
	
	displayLines.forEach(line => console.log(line));
	process.exit(1);
} else if (command == "manage"){
	// console.log("Launching mod manager");
	//const fullUsage = 'node client.js manage [instance, "shared"] ["mods", "config"] ...';
	function usage(instance, tool, action){
		if(tool && tool == "mods"){
			console.log('node client.js manage '+instance+' '+tool+' ["list", "search", "add", "remove", "update"]');
		} else if(tool && tool == "config") {
			console.log('node client.js manage '+instance+' '+tool+' ["list", "edit"]');
		} else {
			console.log('node client.js manage '+(instance || '[instance, "shared"]') +' '+ (tool || '["mods", "config"]') + ' ...');
		}
	}
	const tool = process.argv[4] || "";
	const action = process.argv[5] || "";
	if(instance){
		if(tool == "mods"){
			// allow managing mods
			if(action == "list"){
				modManager.listMods(instance);
			} else if(action == "search"){
				modManager.findMods(process.argv[6]);
			} else if(action == "add" || action == "download"){
				modManager.addMod(process.argv[6], instance);
			} else if(action == "remove" || action == "rm" || action == "delete"){
				modManager.removeMod(process.argv[6], instance);
			} else if(action == "update"){
				modManager.updateAllMods();
			} else {
				usage(instance, tool);
			}
		} else if(tool == "config"){
			// allow managing the config
			if(action == "list" || action == "show" || action == "display"){
				configManager.displayConfig(instance);
			} else if(action == "edit"){
				let newConfigValue = "";
				process.argv.forEach((arg, i)=>{
					if(i >= 8){
						newConfigValue += " "+arg;
					} else if(i >= 7){
						newConfigValue += arg;
					}
				});
				configManager.editConfig(instance, process.argv[6], newConfigValue);
			} else {
				usage(instance, tool);
			}
		} else {
			usage(instance);
		}
	} else {
		console.log('Usage:');
		usage(instance);
	}
	// process.exit(1);
} else if (command == "delete") {
	if (!process.argv[3]) {
		console.error("Usage: node client.js delete [instance]");
		process.exit(1);
	} else if (typeof process.argv[3] == "string" && fs.existsSync("./instances/" + process.argv[3]) && process.argv[3] != "/" && process.argv[3] != "") {
		fileOps.deleteFolderRecursiveSync("./instances/" + process.argv[3]);
		console.log("Deleted instance " + process.argv[3]);
		process.exit(1);
	} else {
		console.error("Instance not found: " + process.argv[3]);
		process.exit(1);
	}
} else if (command == "download") {
	console.log("Downloading mods...");
	// get JSON data about releases
	let res = syncRequest('GET', 'https://api.github.com/repos/Danielv123/factorioClusterioMod/releases', {"headers":{"User-Agent":"Fuck you for requiring user agents!"}});
	let url = JSON.parse(res.getBody())[0].assets[0].browser_download_url;
	let name = JSON.parse(res.getBody())[0].assets[0].name;
	if(url) {
		console.log(url);
		let file = fs.createWriteStream("sharedMods/"+name);
		https.get(url, function(response) {
			response.pipe(file);
			console.log("Downloaded "+name);
		});
	}
} else if (command == "start" && instance === undefined) {
	console.log("ERROR: No instanceName provided!");
	console.log("Usage: node client.js start [instanceName]");
	process.exit(0);
} else if (command == "start" && typeof instance == "string" && instance != "/" && !fs.existsSync(instancedirectory)) {
	// if instance does not exist, create it
	console.log("Creating instance...");
	fs.mkdirSync(instancedirectory);
	fs.mkdirSync(instancedirectory + "/script-output/");
	fs.mkdirSync(instancedirectory + "/saves/");
	fs.writeFileSync(instancedirectory + "/script-output/output.txt", "");
	fs.writeFileSync(instancedirectory + "/script-output/orders.txt", "");
	fs.writeFileSync(instancedirectory + "/script-output/txbuffer.txt", "");
	fs.mkdirSync(instancedirectory + "/mods/");
	fs.mkdirSync(instancedirectory + "/instanceMods/");
	// fs.symlinkSync('../../../sharedMods', instancedirectory + "/mods", 'junction') // This is broken because it can only take a file as first argument, not a folder
	fs.writeFileSync(instancedirectory + "/config.ini", "[path]\r\n\
read-data=__PATH__executable__/../../data\r\n\
write-data=__PATH__executable__/../../../instances/" + instance + "\r\n\
	");
	
	// this line is probably not needed anymore but Im not gonna remove it
	fs.copySync('sharedMods', instancedirectory + "/mods");
	let instconf = {
		"factorioPort": process.env.FACTORIOPORT | Math.floor(Math.random() * 65535),
		"clientPort": process.env.RCONPORT | Math.floor(Math.random() * 65535),
		"clientPassword": Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 8),
	}
	console.log("Clusterio | Created instance with settings:")
	console.log(instconf);
	
	// create instance config
	fs.writeFileSync(instancedirectory + "/config.json", JSON.stringify(instconf, null, 4));
	
	let name = "Clusterio instance: " + instance;
	if (config.username) {
		name = config.username + "'s clusterio " + instance;
	}
	let serversettings = {
		"name": name,
		"description": config.description,
		"tags": ["clusterio"],
		"max_players": "20",
		"visibility": config.visibility,
		"username": config.username,
		"token": config.usertoken,
		"game_password": config.game_password,
		"verify_user_identity": config.verify_user_identity,
		"admins": [config.username],
		"allow_commands": config.allow_commands,
		"autosave_interval": 10,
		"autosave_slots": 5,
		"afk_autokick_interval": 0,
		"auto_pause": config.auto_pause,
	}
	fs.writeFileSync(instancedirectory + "/server-settings.json", JSON.stringify(serversettings, null, 4));
	let createSave = child_process.spawnSync(
		'./' + config.factorioDirectory + '/bin/x64/factorio', [
			'-c', instancedirectory + '/config.ini',
			'--create', instancedirectory + '/saves/save.zip',
		]
	);
	console.log("Instance created!");
} else if (command == "start" && typeof instance == "string" && instance != "/" && fs.existsSync(instancedirectory)) {
	// Exit if no instance specified (it should be, just a safeguard);
	if(instancedirectory != "./instances/undefined"){
		var instanceconfig = require(instancedirectory + '/config');
		instanceconfig.unique = stringUtils.hashCode(instanceconfig.clientPassword);
		if(process.env.FACTORIOPORT){
			instanceconfig.factorioPort = process.env.FACTORIOPORT;
		}
		if(process.env.RCONPORT){
			instanceconfig.rconPort = process.env.RCONPORT;
		}
	} else {
		process.exit(1);
	}
	console.log("Deleting .tmp.zip files");
	let savefiles = fs.readdirSync(instancedirectory + "/saves/");
	for(i = 0; i < savefiles.length; i++){
		if(savefiles[i].substr(savefiles[i].length - 8, 8) == ".tmp.zip") {
			fs.unlinkSync(instancedirectory + "/saves/" + savefiles[i]);
		}
	}
	console.log("Deleting logs");
	// clean old log file to avoid crash
	// file exists, delete so we don't get in trouble
	try {
		fs.unlinkSync(instancedirectory+'/factorio-current.log');
	} catch (err){
		if(err){
			console.log(err);
		} else {
			console.log("Clusterio | Deleting old logs...");
		}
	}
	
	// move mods from ./sharedMods to the instances mod directory
	try {
		fs.mkdirSync(instancedirectory + "/instanceMods/");
	} catch(e){}
	try{rmdirSync(instancedirectory + "/mods");}catch(e){}
	try {
		// mods directory that will be emptied (deleted) when closing the server to facilitate seperation of instanceMods and sharedMods
		fs.mkdirSync(instancedirectory + "/mods/");
	} catch(e){}
	console.log("Clusterio | Moving shared mods from sharedMods/ to instance/mods...");
	fs.copySync('sharedMods', instancedirectory + "/mods");
	console.log("Clusterio | Moving instance specific mods from instance/instanceMods to instance/mods...");
	fs.copySync(instancedirectory + "/instanceMods", instancedirectory + "/mods");

	process.on('SIGINT', function () {
		console.log("Caught interrupt signal");
		messageInterface("/quit");
	});

	// Spawn factorio server
	//var serverprocess = child_process.exec(commandline);
	fileOps.getNewestFile(instancedirectory + "/saves/", fs.readdirSync(instancedirectory + "/saves/"),function(err, latestSave) {
		if(err) {
			console.log("Your savefile seems to be missing. This might because you created an instance without having factorio\
			installed and configured properly. Try installing factorio and adding your savefile to instances/[instancename]/saves/");
			throw err;
		}
		// implicit global
		serverprocess = child_process.spawn(
			'./' + config.factorioDirectory + '/bin/x64/factorio', [
				'-c', instancedirectory + '/config.ini',
				'--start-server', latestSave.file,
				'--rcon-port', Number(process.env.RCONPORT) || instanceconfig.clientPort,
				'--rcon-password', instanceconfig.clientPassword,
				'--server-settings', instancedirectory + '/server-settings.json',
				'--port', Number(process.env.FACTORIOPORT) || instanceconfig.factorioPort
			], {
				'stdio': ['pipe', 'pipe', 'pipe']
			}
		);

		serverprocess.on('close', (code) => {
			console.log(`child process exited with code ${code}`);
			process.exit();
		});
		serverprocess.stdout.on("data", (data) => {
			// log("Stdout: " + data);
			if(data.toString('utf8').includes("Couldn't parse RCON data: Maximum payload size exceeded")){
				console.error("ERROR: RCON CONNECTION BROKE DUE TO TOO LARGE PACKET!");
				console.error("Attempting reconnect...");
				client.close();
				client.connect();
			}
			if(process.platform == "linux"){
				// we have to log on linux because linux only shows stdout of the first process launched
				console.log('Factorio: ' + data);
			}
		});
		serverprocess.stderr.on('data', (chunk) => {
			console.log('ERR: ' + chunk);
		});

		// connect to the server with rcon
		if(process.platform != "linux"){
			// IP, port, password
			client = new Rcon({
				host: 'localhost',
				port: Number(process.env.RCONPORT) || instanceconfig.clientPort,
				password: instanceconfig.clientPassword,
				timeout: 0
			});
			
			// check the logfile to see if the RCON interface is running as there is no way to continue without it
			// we read the log every 2 seconds and stop looping when we start connecting to factorio
			function checkRcon() {
				fs.readFile(instancedirectory+"/factorio-current.log", function (err, data) {
					// if (err) console.log(err);
					if(data && data.indexOf('Starting RCON interface') > 0){
						client.connect();
					} else {
						setTimeout(function(){
							checkRcon();
						},2000);
					}
				});
			}
			setTimeout(checkRcon, 5000);
		
			client.on('authenticated', function () {
				console.log('Clusterio | RCON Authenticated!');
				instanceManagement(); // start using rcons
			}).on('connected', function () {
				console.log('Clusterio | RCON Connected!');
				// getID();
			}).on('disconnected', function () {
				console.log('Clusterio | RCON Disconnected!');
				process.exit(0); // exit because RCON disconnecting is undefined behaviour and we rather just wanna restart now
			});
		} else if(process.platform == "linux"){
			// TODO: Check if this works fine on linux or if it has to be delayed until the server starts properly
			instanceManagement();
		}

		// set some globals
		confirmedOrders = [];
		lastSignalCheck = Date.now();
	});
}

// ensure instancemanagement only ever runs once
_.once(instanceManagement);
function instanceManagement() {
	console.log("Started instanceManagement();");
	// load plugins and execute onLoad event
	let pluginDirectories = fileOps.getDirectoriesSync("./sharedPlugins/");
	let plugins = [];
	for(let i=0; i<pluginDirectories.length; i++) {
		let I = i
		let log = function(message) {
			console.log("Clusterio | "+ pluginDirectories[I] + " | " + message);
		}
		// these are our two config files. We need to send these in case plugin
		// wants to contact master or know something.
		let combinedConfig = deepmerge(instanceconfig,config,{clone:true})
		let pluginConfig = require("./sharedPlugins/" + pluginDirectories[i] + "/config.js");
		
		if(!global.subscribedFiles) {
			global.subscribedFiles = {};
		}
		if(pluginConfig.binary == "nodePackage"){
			// require index.js.main() of plugin and execute it as a function
			let pluginClass = require("./sharedPlugins/" + pluginDirectories[I] + "/index.js");
			plugins[I] = new pluginClass(combinedConfig, function(data){
				if(data.toString('utf8')[0] != "/") {
					log("Stdout: " + data.toString('utf8'));
				} else {
					messageInterface(data.toString('utf8'));
				}
			});
			if(pluginConfig.scriptOutputFileSubscription && typeof pluginConfig.scriptOutputFileSubscription == "string"){
				if(global.subscribedFiles[pluginConfig.scriptOutputFileSubscription]) {
					// please choose a unique file to subscribe to. If you need plugins to share this interface, set up a direct communication
					// between those plugins instead.
					throw "FATAL ERROR IN " + pluginDirectories[i] + " FILE ALREADY SUBSCRIBED " + pluginConfig.scriptOutputFileSubscription;
				}
				
				if (!fs.existsSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription)) {
					// Do something
					fs.writeFileSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, "");
				}
				global.subscribedFiles[pluginConfig.scriptOutputFileSubscription] = true;
				
				fs.watch(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, function (eventType, filename) {
					// get array of lines in file
					let stuff = fs.readFileSync(instancedirectory + "/script-output/" + filename, "utf8").split("\n");
					// if you found anything, reset the file
					if (stuff[0]) {
						fs.writeFileSync(instancedirectory + "/script-output/" + filename, "");
					}
					for (let i = 0; i < stuff.length; i++) {
						if (stuff[i]) {
							plugins[I].scriptOutput(stuff[i]);
						}
					}
				});
			}
			console.log("Clusterio | Loaded plugin " + pluginDirectories[i]);
		} else if(pluginConfig.binary != "nodePackage"){
			// handle as fragile executable plugin
			let args = pluginConfig.args || [];
			plugins[I]=child_process.spawn(pluginConfig.binary, args, {
				cwd: "./sharedPlugins/"+pluginDirectories[i],
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			
			/*
				to send to stdin, use:
				spawn.stdin.write("text\n");
			*/
			// If plugin has subscribed to a file, send any text appearing in that file to stdin
			if(pluginConfig.scriptOutputFileSubscription && typeof pluginConfig.scriptOutputFileSubscription == "string") {
				if(global.subscribedFiles[pluginConfig.scriptOutputFileSubscription]) {
					// please choose a unique file to subscribe to. If you need plugins to share this interface, set up a direct communication
					// between those plugins instead.
					throw "FATAL ERROR IN " + pluginDirectories[i] + " FILE ALREADY SUBSCRIBED " + pluginConfig.scriptOutputFileSubscription;
				}
				
				if (!fs.existsSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription)) {
					// Do something
					fs.writeFileSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, "");
				}
				global.subscribedFiles[pluginConfig.scriptOutputFileSubscription] = true;
				fs.watch(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, function (eventType, filename) {
					// get array of lines in file
					let stuff = fs.readFileSync(instancedirectory + "/script-output/" + filename, "utf8").split("\n");
					// if you found anything, reset the file
					if (stuff[0]) {
						fs.writeFileSync(instancedirectory + "/script-output/" + filename, "");
					}
					for (let i = 0; i < stuff.length; i++) {
						if (stuff[i]) {
							plugins[I].stdin.write(stuff[i]);
						}
					}
				});
			}
			// these are our two config files. We need to send these in case plugin
			// wants to contact master or know something.
			// send through script-output file, maybe more compat?
			fs.writeFileSync(instancedirectory + "/script-output/" + pluginConfig.scriptOutputFileSubscription, JSON.stringify(combinedConfig)+"\r\n");
			// send directly through stdin
			// plugins[i].stdin.write(JSON.stringify(combinedConfig)+"\n");
			
			console.log("Clusterio | Loaded plugin " + pluginDirectories[i]);
			plugins[i].stdout.on("data", (data) => {
				if(data.toString('utf8')[0] != "/") {
					log("Stdout: " + data.toString('utf8'))
				} else {
					messageInterface(data.toString('utf8'));
				}
			});
			plugins[i].stderr.on("data", (data) => {
				log("STDERR: " + data);
			});
			plugins[i].on('close', (code) => {
				log(`child process exited with code ${code}`);
			});
		}
	}
	
	// world IDs ------------------------------------------------------------------
	hashMods(instance, function(modHashes){
		setInterval(getID, 10000);
		getID();
		function getID() {
			messageInterface("/silent-command game.write_file('tempfile.txt', 'connected_players ' .. #game.connected_players .. '\\n', true, 0)", function(err) {setTimeout(function(){
				// get array of lines in file
				if(fs.existsSync(instancedirectory + "/script-output/tempfile.txt")) {
					var data = fs.readFileSync(instancedirectory + "/script-output/tempfile.txt", "utf8").split("\n");
					// delete when we are done
					fs.unlink(instancedirectory + "/script-output/tempfile.txt", function(){});
				}
				// if we actually got anything from the file, proceed to categorize it
				if (data && data[0]) {
					while (data[0]) {
						let q = data[0].split(" ");
						// delete array element
						data.splice(0,1);
						if(q[0] == "connected_players" && Number(q[1]) != NaN) {
							instanceInfo.playerCount = q[1];
						}
					}
				} else {
					instanceInfo.playerCount = 0;
				}
				var payload = {
					time: Date.now(),
					rconPort: instanceconfig.clientPort,
					rconPassword: instanceconfig.clientPassword,
					serverPort: instanceconfig.factorioPort,
					unique: instanceconfig.unique,
					publicIP: config.publicIP, // IP of the server should be global for all instances, so we pull that straight from the config
					mods:modHashes,
					playerCount: instanceInfo.playerCount || 0,
					instanceName: instance,
				}
				getMac(function (err, mac) {
					if (err) {
						console.log("##### getMac crashed, but we don't really give a shit because we are probably closing down #####");
					} else {
						payload.mac = mac
						console.log("Registered our precense with master "+config.masterIP+" at " + payload.time);
						needle.post("https://" + config.masterIP + ":" + config.masterPort + '/api/getID', payload, needleReqOptions, function (err, response, body) {
							if (err && err.code != "ECONNRESET"){
								console.error("We got problems, something went wrong when contacting master");
								console.error(err);
							} else if (response && response.body) {
								// In the future we might be interested in whether or not we actually manage to send it, but honestly I don't care.
								console.log(response.body);
							}
						});
					}
				});
			},1000)});
		}
	});
	
	
	// Mod uploading and management -----------------------------------------------
	// get mod names and hashes
	// string: instance, function: callback
	
	setTimeout(function(){hashMods(instance, uploadMods)}, 5000);
	function uploadMods(modHashes) {
		// [{modName:string,hash:string}, ... ]
		for(let i=0;i<modHashes.length;i++){
			let payload = {
				modName: modHashes[i].modName,
				hash: modHashes[i].hash,
			}
			needle.post("https://" + config.masterIP + ":" + config.masterPort + '/api/checkMod', payload, needleReqOptions, function (err, response, body) {
				if(err) throw err // Unable to contact master server! Please check your config.json.
				if(response && body && body == "found") {
					console.log("master has mod");
				} else if (response && body && typeof body == "string") {
					let mod = response.body;
					if(config.uploadModsToMaster){
						console.log("Sending mod: " + mod);
						// Send mods master says it wants
						// response.body is a string which is a modName.zip
						var req = request.post("https://"+config.masterIP + ":" + config.masterPort + '/api/uploadMod', needleReqOptions, function (err, resp, body) {
							if (err) {
								console.log('Error!');
								throw err
							} else {
								console.log('URL: ' + body);
							}
						});
						var form = req.form();
						form.append('file', fs.createReadStream("./instances/"+instance+"/mods/"+mod));
					} else {
						console.log("Not sending mod: " + mod + " to master because config.uploadModsToMaster is not enabled")
					}
				}
			});
		}
	}
	
	// flow/production statistics ------------------------------------------------------------
	oldFlowStats = false
	setInterval(function(){
		fs.readFile(instancedirectory + "/script-output/flows.txt", {encoding: "utf8"}, function(err, data) {
			if(!err && data) {
				let timestamp = Date.now();
				data = data.split("\n");
				let flowStats = [];
				for(let i = 0; i < data.length; i++) {
					// try catch to remove any invalid json
					try{
						flowStats[flowStats.length] = JSON.parse(data[i]);
					} catch (e) {
						// console.log(" invalid json: " + i);
						// some lines of JSON are invalid but don't worry, we just filter em out
					}
				}
				// fluids
				let flowStat1 = flowStats[flowStats.length-1].flows.player.input_counts
				// items
				let flowStat2 = flowStats[flowStats.length-2].flows.player.input_counts
				// merge fluid and item flows
				let totalFlows = {};
				for(let key in flowStat1) totalFlows[key] = flowStat1[key];
				for(let key in flowStat2) totalFlows[key] = flowStat2[key];
				if(oldFlowStats && totalFlows && oldTimestamp) {
					let payload = objectOps.deepclone(totalFlows);
					// change from total reported to per time unit
					for(let key in oldFlowStats) {
						// get production per minute
						payload[key] = Math.floor((payload[key] - oldFlowStats[key])/(timestamp - oldTimestamp)*60000);
						if(payload[key] < 0) {
							payload[key] = 0;
						}
					}
					for(let key in payload) {
						if(payload[key] == '0') {
							delete payload[key];
						}
					}
					console.log("Recorded flows, copper plate since last time: " + payload["copper-plate"]);
					needle.post("https://" + config.masterIP + ":" + config.masterPort + '/api/logStats', {timestamp: timestamp, instanceID: instanceconfig.unique,data: payload}, needleReqOptions, function (err, response, body) {
						// we did it, keep going
					});
				}
				oldTimestamp = timestamp;
				oldFlowStats = totalFlows;
				fs.writeFileSync(instancedirectory + "/script-output/flows.txt", "");
			}
		});
		// we don't need to update stats quickly as that could be expensive
	}, 60000*5);
	
	// provide items --------------------------------------------------------------
	// trigger when something happens to output.txt
	fs.watch(instancedirectory + "/script-output/output.txt", function (eventType, filename) {
		// get array of lines in file
		let items = fs.readFileSync(instancedirectory + "/script-output/output.txt", "utf8").split("\n");
		// if you found anything, reset the file
		if (items[0]) {
			fs.writeFileSync(instancedirectory + "/script-output/output.txt", "");
		}
		for (let i = 0; i < items.length; i++) {
			if (items[i]) {
				let g = items[i].split(" ");
				g[0] = g[0].replace("\u0000", "");
				// console.log("exporting " + JSON.stringify(g));
				// send our entity and count to the master for him to keep track of
				needle.post("https://" + config.masterIP + ":" + config.masterPort + '/api/place', needleReqOptions, {
					name: g[0],
					count: g[1],
					instanceName: instance, // name of instance
					instanceID: instanceconfig.unique, // a hash computed from the randomly generated rcon password
				}, function (err, resp, body) {
					if(body == "failure") console.error("#### Export failed! Lost: "+g[1]+" "+g[0]);
					if(config.logItemTransfers){
						if(body == "success") console.log(`Exported ${g[1]} ${g[0]} to master`);
					}
				});
			}
		}
	});
	// request items --------------------------------------------------------------
	setInterval(function () {
		// get array of lines in file
		let items = fs.readFileSync(instancedirectory + "/script-output/orders.txt", "utf8").split("\n");
		// if we actually got anything from the file, proceed and reset file
		if (items[0]) {
			fs.writeFileSync(instancedirectory + "/script-output/orders.txt", "");
			// prepare a package of all our requested items in a more tranfer friendly format
			var preparedPackage = {};
			for (let i = 0; i < items.length; i++) {
				(function (i) {
					if (items[i]) {
						items[i] = items[i].split(" ");
						items[i][0] = items[i][0].replace("\u0000", "");
						items[i][0] = items[i][0].replace(",", "");
						if (preparedPackage[items[i][0]]) {
							// if we have buffered some already, sum the new items
							if (typeof Number(preparedPackage[items[i][0]].count) == "number" && typeof Number(items[i][1]) == "number") {
								preparedPackage[items[i][0]] = {
									"name": items[i][0],
									"count": Number(preparedPackage[items[i][0]].count) + Number(items[i][1]),
									"instanceName":instance,
									"instanceID":instanceconfig.unique,
								};
							// else just add em in without summing
							} else if (typeof Number(items[i][1]) == "number") {
								preparedPackage[items[i][0]] = {
									"name": items[i][0],
									"count": Number(items[i][1]),
									"instanceName":instance,
									"instanceID":instanceconfig.unique,
								};
							}
						// this condition will NEVER be triggered but we know how that goes
						} else if (typeof Number(items[i][1]) == "number") {
							preparedPackage[items[i][0]] = {
								"name": items[i][0],
								"count": Number(items[i][1]),
								"instanceName":instance,
								"instanceID":instanceconfig.unique,
							};
						}
					}
				})(i);
			}
			// request our items, one item at a time
			for (let i = 0; i < Object.keys(preparedPackage).length; i++) {
				// console.log(preparedPackage[Object.keys(preparedPackage)[i]]);
				needle.post("https://" + config.masterIP + ":" + config.masterPort + '/api/remove', preparedPackage[Object.keys(preparedPackage)[i]], needleReqOptions, function (err, response, body) {
					if (response && response.body && typeof response.body == "object") {
						// buffer confirmed orders
						confirmedOrders[confirmedOrders.length] = {
							[response.body.name]: response.body.count,
						}
						if(config.logItemTransfers){
							console.log(`Imported ${response.body.count} ${response.body.name} from master`);
						}
					}
				});
			}
			// if we got some confirmed orders
			// console.log("Importing " + confirmedOrders.length + " items! " + JSON.stringify(confirmedOrders));
			sadas = JSON.stringify(confirmedOrders);
			confirmedOrders = [];
			// send our RCON command with whatever we got
			messageInterface("/silent-command remote.call('clusterio', 'importMany', '" + sadas + "')");
			sadas = null;
		}
	}, 3000);
	// COMBINATOR SIGNALS ---------------------------------------------------------
	// get inventory from Master and RCON it to our slave
	setInterval(function () {
		needle.get("https://" + config.masterIP + ":" + config.masterPort + '/api/inventory', needleReqOptions, function (err, response, body) {
			if(err){
				console.log("Unable to get JSON master/api/inventory, master might be unaccessible");
			} else if (response && response.body) {
				// Take the inventory we (hopefully) got and turn it into the format LUA accepts
				try {
					var inventory = JSON.parse(response.body);
				} catch (e){
					console.log(e);
				}
				var inventoryFrame = {};
				for (let i = 0; i < inventory.length; i++) {
					inventoryFrame[inventory[i].name] = Number(inventory[i].count);
					if(inventoryFrame[inventory[i].name] >= Math.pow(2, 31)){
						inventoryFrame[inventory[i].name] = Math.pow(2, 30); // set it waaay lower, 31 -1 would probably suffice
					}
				}
				inventoryFrame["signal-unixtime"] = Math.floor(Date.now()/1000);
				// console.log("RCONing inventory! " + JSON.stringify(inventoryFrame));
				messageInterface("/silent-command remote.call('clusterio', 'receiveInventory', '" + JSON.stringify(inventoryFrame) + "')");
			}
		});
	}, 1000);
	// REMOTE SIGNALLING
	// send any signals the slave has been told to send
	setInterval(function () {
		// Fetch combinator signals from the server
		needle.post("https://" + config.masterIP + ":" + config.masterPort + '/api/readSignal', needleReqOptions, {
			since: lastSignalCheck
		}, function (err, response, body) {
			if (response && response.body) {
				if(typeof response.body == "string") response.body = JSON.parse(response.body);
				// Take the new combinator frames and compress them so we can use a single command
				let frameset = [];
				for (let i = 0; i < response.body.length; i++) {
					frameset[i] = response.body[i].frame;
				}
				// console.log(frameset);
				// Send all our compressed frames
				messageInterface("/silent-command remote.call('clusterio', 'receiveMany', '" + JSON.stringify(frameset) + "')");
			}
		});
		// after fetching all the latest frames, we take a timestamp. During the next iteration, we fetch all frames submitted after this.
		lastSignalCheck = Date.now();

		// get outbound frames from file and send to master
		// get array of lines in file, each line should correspond to a JSON encoded frame
		let signals = fs.readFileSync(instancedirectory + "/script-output/txbuffer.txt", "utf8").split("\n");
		// if we actually got anything from the file, proceed and reset file
		if (signals[0]) {
			fs.writeFileSync(instancedirectory + "/script-output/txbuffer.txt", "");
			// loop through all our frames
			for (let i = 0; i < signals.length; i++) {
				(function (i) {
					if (signals[i]) {
						// signals[i] is a JSON array called a "frame" of signals. We timestamp it for storage on master
						// then we unpack and RCON in this.frame to the game later.
						let framepart = JSON.parse(signals[i]);
						let doneframe = {
								time: Date.now(),
								frame: framepart, // thats our array of objects(single signals);
							}
							// console.log(doneframe);
						needle.post("https://" + config.masterIP + ":" + config.masterPort + '/api/setSignal', doneframe, needleReqOptions, function (err, response, body) {
							if (response && response.body) {
								// In the future we might be interested in whether or not we actually manage to send it, but honestly I don't care.
							}
						});
					}
				})(i);
			}
		}
	}, 1000);
} // END OF INSTANCE START ---------------------------------------------------------------------

// string, function
// returns [{modName:string,hash:string}, ... ]
function hashMods(instanceName, callback) {
	if(!callback) {
		throw "ERROR in function hashMods NO CALLBACK"
	}
	function callback2(hash, modName){
		hashedMods[hashedMods.length] = {
			modName: modName,
			hash: hash,
		}
		// check if this callback has ran once for each mod
		if(hashedMods.length == /*mods.length*/ + instanceMods.length) {
			callback(hashedMods);
		}
		//console.log(modname);
	}
	let hashedMods = [];
	var i = 0;
	/*let mods = fs.readdirSync("./sharedMods/")*/
	let instanceMods = fs.readdirSync("./instances/"+instanceName+"/mods/");
	
	for(o=0;o<instanceMods.length;o++) {
		if(path.extname(instanceMods[o]) != ".zip") {
			instanceMods.splice(instanceMods.indexOf(instanceMods[o]), 1); // remove element from array
		}
	}
	for(i=0; i<instanceMods.length; i++){
		let path = "./instances/"+instanceName+"/mods/"+instanceMods[i];
		let name = instanceMods[i];
		let options = {
			files:path,
		}
		// options {files:[array of paths]}
		hashFiles(options, function(error, hash) {
			// hash will be a string if no error occurred
			if(!error){
				callback2(hash, name);
			} else {
				throw error;
			}
		});
	}
}
