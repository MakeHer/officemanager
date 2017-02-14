'use strict'

const express = require('express')
const Slapp = require('slapp')
const ConvoStore = require('slapp-convo-beepboop')
const Context = require('slapp-context-beepboop')

// for Delivery Record
const async = require('async')
const GoogleSpreadsheet = require('google-spreadsheet')


var date = new Date();
var delivery_payload;
var sheet_id, pk, doc;
var team_id;
var creds;

// use `PORT` env var on Beep Boop - default to 3000 locally
var port = process.env.PORT || 3000

var slapp = Slapp({
  // Beep Boop sets the SLACK_VERIFY_TOKEN env var
  verify_token: process.env.SLACK_VERIFY_TOKEN,
  convo_store: ConvoStore(),
  context: Context()
})

//  inout = 1 if in, 2 if out -going parcel
function newDelivery(msg,inout,delivery, callback){
    var e;
    date = new Date()
        sheet_id = msg.meta.config.DELIVERY_SHEET_ID 
            doc = new GoogleSpreadsheet(sheet_id);
            //pk = (process.env.G_PRIVATE_KEY + process.env.G_PRIVATE_KEY2)||( msg.meta.config.G_PRIVATE_KEY + msg.meta.config.G_PRIVATE_KEY2 )
            pk = (msg.meta.config.G_PRIVATE_KEY + msg.meta.config.G_PRIVATE_KEY2)
            pk = pk.replace(/(?:\\[rn])+/g,"\n") 

            creds = {

                client_email: msg.meta.config.G_CLIENT_EMAIL
            ,
                private_key: pk

            }

            doc.useServiceAccountAuth(creds, (err)=>{
                if(!err){
                    doc.addRow(inout,delivery,callback(err,msg))
                }
                
            });
    /*
    async.series([
        function setAuth(step) {
            // see notes below for authentication instructions! 
            sheet_id = process.env.DELIVERY_SHEET_ID  || msg.config.DELIVERY_SHEET_ID 
            doc = new GoogleSpreadsheet(sheet_id);
            pk = (process.env.G_PRIVATE_KEY + process.env.G_PRIVATE_KEY2)||( msg.config.G_PRIVATE_KEY + msg.config.G_PRIVATE_KEY )

            pk = pk.replace(/(?:\\[rn])+/g,"\n") 

            creds = {

                client_email: process.env.G_CLIENT_EMAIL || msg.config.G_CLIENT_EMAIL
            ,
                private_key: pk

            }

            doc.useServiceAccountAuth(creds, step);
        },
        function getInfoAndWorksheets(step) {
            doc.getInfo(function(err, info) {
                console.log('Loaded doc: '+info.title+' by '+info.author.email);
                step();
            });
        },
        function addRowtoDoc(step){
            doc.addRow(inout,delivery,step)
        }
]);
    */
}




var HELP_TEXT = `
I will respond to the following messages:
\`help\` - to see this message.
\`hi\` - to demonstrate a conversation that tracks state.
\`thanks\` - to demonstrate a simple response.
\`<type-any-other-text>\` - to demonstrate a random emoticon response, some of the time :wink:.
\`attachment\` - to see a Slack attachment message.
`

//*********************************************
//  PACKAGE DELIVERIES 
//*********************************************

// TODO: make a seperate module for this

/*
    For the moment, we'll formally enter records through /package. 
    The bot will listen for events on the #deliveries channel. Any keywords like package, for, from, @mentions
    will prompt the bot to whisper and provide help text to enter formally.

*/

/*
    Parse route:
        - classify receive or send
            if "for @mention", assume receive and "from"
            if contains one of delivery services AND a continuous (long) number string, asssume sending
        - "for (.*)/w", to (.*)/w
        - "from (.*)"
        
*/

//
// PACKAGE DELIVERIES: CONSTANTS
//

var delivery_bot_msg_obj={
    text: {},
    as_user: false,
    username: "Mango's Delivery Bot",
    icon_emoji: ":package:"
}

var PACKAGE_HELP_FLAVOURTEXT=[
        "_Are you checking out my bot? :wink:_",
        "_Please be gentle when handling my bot. :kissing_heart:_"
    ]
var PACKAGE_HELP_TEXT = `
    \`/package\` has the Delivery Bot log incoming and outgoing deliveries.
    \t Available commands:
    \t \t \`/package in [for \@user] from <sender name and/or address>\`
    \t \t \t Record _incoming_ parcels that have been _delivered to the office_. If no recipient, assumes recipient is gor general office.
    \t \t \`/package out for <name> [service provider] [tracking#]\`
    \t \t \t Record _outgoing_ parcels
    \t \t \`/package info\`
    \t \t \t Gives info about package logs including, spreadsheet url, number of parcels received today and in the last week.
    `

//TODO: make this persistent
var DELIVERY_SERVICES = ['auspost','startrack','dhl','couriersplease','fedex']


//Relevant keywords for parsing
var kw_parcel = ["parcel","package","delivery"]
var kw_in = ["in","received","recieved","receive","recieve","arrived","arrive"]
var kw_out = ["out","sent","outgoing","dispatched","registered"]
var kw_to = ["for","to"]
var kw_from = ["from"]
var kw_desc = ["containing", "contains", "desc", "description"]
var kw_loc = ["location", "sitting", "placed", "put","left"]
var kw_req = ["requester", "on behalf of", "requested by"]


var delivery_ambient_detect = "(in|received|recieved|receive|recieve|arrived|arrive|out|sent|outgoing|dispatched|registered|for|to|from|containing|contains|desc|description|parcel|package|delivery|(\\<\\@\\w+\\>))"

var delivery_amb_re = new RegExp(delivery_ambient_detect,"ig")

//Valid cmds (currently not in use)
var valid_cmds = ["help","in","received","receive","recieve","out","sent"]

//
// Helper methods
//

function fieldBuilder(log_payload, short_field){
    var fields = []
    for (var key in log_payload){
        if (log_payload.hasOwnProperty(key)){
            fields.push({
                "title": key,
                "value": log_payload[key],
                "short": short_field
            })
        }
    }
    return fields;
}

function find_key(string_array,possible_keys){
    var x = false;
    for (var i = 0; i<possible_keys.length; i++){
        x = x || string_array.indexOf(possible_keys[i]) > 0 && string_array.indexOf(possible_keys[i]);
    }
    var result = x>0 && string_array[x].trim();
    
    return result || ~result && "";

}
function find_value(string_array,possible_keys){
    var x = false;
    for (var i = 0; i<possible_keys.length; i++){
        x = x || string_array.indexOf(possible_keys[i]) > 0 && string_array.indexOf(possible_keys[i]);
    }
    var result = x>0 && string_array[x+1].trim();
    
    return result || ~result && "";
}

function prepareConfirmation(msg,text,log_payload,type){
    // grab user's display icon
    slapp.client.users.info({token:msg.meta.bot_token,user:msg.meta.user_id},(err,data)=>{if(err){console.log(err)}
    var p = data["user"]["profile"]["image_32"]
    msg.respond(msg.body.response_url,{
        text: 'Confirm adding the following to the delivery register?',
        response_type: "ephemeral",
        attachments: [{
            "callback_id": "send_log",
            "author_name": msg.body.user_name,
            "author_icon":  p,
            "fields": fieldBuilder(log_payload,true),
            "actions": [
                {
                    "name":"confirm",
                    "text":"Confirm",
                    "type":"button",
                    "style": "primary",
                    "value": "confirm"
                },
                {
                    "name":"confirm",
                    "text":"Cancel",
                    "type":"button",
                    "value": "cancel"
                }

            ]
        }]
                 
    }, (err,msg)=>{
        if(err){console.log(err);console.log(msg);}
    }).route('handleDeliveryConfirmation', {payload: log_payload, type: type, text: text}, 6000);

    })
}
function logPayload(state,success){
    newDelivery("",state.type+2,Object.assign({"success": success,"input":state.text},state.payload),(err,msg)=>{}
)}

//checks for keyword compliance
function checkKW(msg,kwc,q){
    var x;
    for (var i=0; i<kwc.length; i++){
        x = x || q.indexOf(kwc[i]) > 0 
    }
        if (!x){
            msg.respond("Error: incoming packages requires keyword(s): "+kwc.join(" or "));
            msg.respond(PACKAGE_HELP_TEXT);
        return false;
        }
        return true;
}

function inDelivery(msg,text,command,q){
    
    //compulsory keywords: does question have all compulsory keywords?
    if (!checkKW(msg,kw_from,text)){
        return;
    }

    //keywords
    var kw = kw_to.concat(kw_from,kw_desc,kw_loc); 
    var kw_re = new RegExp("("+kw.join("|")+")","i");

    // split all arguments based on keywords/flags
    var q_arr = text.toLowerCase().split(kw_re)

    var date = new Date();
    var log_payload = {
        "created_on": date.toString(),
        "created_by": msg.body.user_name,
        "from": find_value(q_arr,kw_from),
        "to": find_value(q_arr,kw_to),
        "description": find_value(q_arr,kw_desc),
        "location": find_value(q_arr,kw_loc)
    }
    
    if (log_payload.to === "me"){
        log_payload.to = msg.body.user_name
    }

    
    prepareConfirmation(msg,text,log_payload,1)

}


//
// PACKAGE DELIVERIES: slash commands
//


// cmd: helpText
slapp.command('/package', 'help',(msg,text)=>{
    msg.respond("*Help*\n"+PACKAGE_HELP_FLAVOURTEXT[Math.floor(Math.random()*2)]
).respond(PACKAGE_HELP_TEXT)
});

// cmd: helpText
slapp.command('/package', 'synonyms',(msg,text)=>{
    var kw_arr = [kw_in,kw_out,kw_to,kw_from,kw_desc,kw_loc]
    var s = ""
    for (var i in kw_arr){
        var sub = kw_arr[i].length>1? kw_arr[i].slice(1):""
        s += "*"+kw_arr[i][0]+":*\t"+sub+"\n"
    }
    var response = "*Synonyms*\n" + s
    msg.respond(response)
});

slapp.command('/package', 'info', (msg,text)=>{
    msg.respond(
`
*Info*
spreadsheetID: \t ${process.env.DELIVERY_SHEET_ID}
Daily stats: \t COMING_SOON
author: \t C Klafas (calla.klafas@gmail.com) Feb 2017
    `)
})

// (TODO)cmd: List (last x) Received Packages

// (TODO)cmd: (last x) Sent packages


slapp.command('/package', '('+kw_to.join("|")+') (@|me)(.*)', (msg,text,command,q)=>{
    inDelivery(msg,text,command,q);
})

// cmd: log package in (received)
slapp.command('/package', '('+kw_in.join("|")+') (.*)', (msg,text,command,q)=>{
    inDelivery(msg,text,command,q);
})

slapp.route('handleDeliveryConfirmation',(msg,state)=>{

    if (msg.type !== 'action'){
        msg
          .say('Please choose Confirm or Cancel button :wink:')
          .route('handleDeliveryConfirmation', state, 60)
        return
      } 

    let answer = msg.body.actions[0].value
    if (answer !== 'confirm'){
        logPayload(state,false)
        msg.respond(msg.body.response_url,{
            text: "Delivery not recorded",
            replace_original: true
        })
        return
    }

    newDelivery(msg, state.type, state.payload, (err,msg)=>{
        if(err){
            console.log(err)
            msg.respond(msg.body.response_url,{
                text: 'Error: Could not update spreadsheet',
                replace_original: true
            })
            return;
        }
        else{
            logPayload(state,true)
            msg.respond(msg.body.response_url,{
                text: 'Logged parcel! :muscle:',
                replace_original: true
            },(err,msg)=>{})

            // if recorded a parcel receipt, notify on the deliveries channel
            if (state.type == 1){
                if (state.payload.to[0]==="@"){
                    mentionUser(msg,state)
                }
                else
                deliveryAlert(msg,state,"")
            }
                    
        }})
   });

   
function deliveryAlert(msg,state,text){
    var text2
    if(state.type==1){
        text2 = "Package received"
    }
    else if(state.type==2){
        text2 = "Package sent"
    }
    slapp.client.chat.postMessage(Object.assign(delivery_bot_msg_obj,{
            token: msg.meta.bot_token,
        channel: process.env.DELIVERY_CHANNEL || msg.meta.config.DELIVERY_CHANNEL,
        //text: `<@${user_id}|${state.payload.to.substring(1)}> Package received.`,
        text: text+ "Package received",
        attachments:[{
                fields: fieldBuilder(state.payload,true)
            }]
    }), (err,data)=>{
        if(err){
            console.log(err);
        }   
    })



}

function mentionUser(msg,state){
        var user_id
        slapp.client.users.list({
        token: msg.meta.bot_token
    },(err,data)=>{
        if(err){console.log("user list error:");console.log(err)}
        else{
        for (var u in data.members){
            if (data.members[u].hasOwnProperty("name") && data.members[u]["name"]===state.payload.to.substring(1) && data.members[u].hasOwnProperty("id")){
                user_id = data.members[u]["id"]
                break
            }
        }
        var text =  (user_id && `<@${user_id}|${state.payload.to.substring(1)}>`) 
        deliveryAlert(msg,state,text+" ")
        }
    })
}



//Record out package (sent)
slapp.command('/package', '('+kw_out.join("|")+')'+'(.*)', (msg,text,command,q)=>{
    if (!checkKW(msg,kw_to,text)){
        return;
    }
        
   //keywords
    var kw = kw_to.concat(kw_from,kw_desc,kw_loc,DELIVERY_SERVICES,kw_req); 
    var kw_re = new RegExp("("+kw.join("|")+")","i");

    // split all arguments based on keywords/flags
    var q_arr = q.toLowerCase().split(kw_re)

    var date = new Date();
    var log_payload = {
        "created_on": date.toString(),
        "created_by": msg.body.user_name,
        "from": find_value(q_arr,kw_from),
        "to": find_value(q_arr,kw_to),
        "description": find_value(q_arr,kw_desc),
        "location": find_value(q_arr,kw_loc),
        "service": find_key(q_arr,DELIVERY_SERVICES),
        "tracking": find_value(q_arr,DELIVERY_SERVICES),
        "requester": find_value(q_arr,kw_req)
    }

    // TODO: if leftover unaccounted for information, log entire message.
    prepareConfirmation(msg,text,log_payload,2)
});



// Delivery
slapp.command('/delivery', 'received (.*)', (msg, text, question)=>{
    delivery_payload = {
        user : msg.body.user_name,
        description: 'test'
    }
    newDeliveryIn(msg,delivery_payload,function(msg){
        msg.respond('Error: Could not update spreadsheet')
        //maybe add a log here
    });
})

slapp.command('/package','.*',(msg,text)=>{
    msg.respond("Invalid use of \`package\`\n. Type \`\\package help` for use.")
})

//TODO: make a log sheet in the same spreadsheet

//
// PACKAGE DELIVERIES: message response
//

slapp.message("auth sheets",["direct_mention","direct_message"], (msg) =>{

        connectSheets(msg,function(){console.log(doc)})
})

// Listening for package logs (any keyword mentioned three times or more)
slapp.message(delivery_amb_re, ['ambient'], (msg) => {
    //atleast have 3 matches before triggering
    if (msg.body.event.text.match(delivery_amb_re).length>2){
        slapp.client.im.open({token: msg.meta.bot_token, user: msg.meta.user_id}, (err,data)=>{
            if(err){console.log(err); return;}
            slapp.client.chat.postMessage(Object.assign(delivery_bot_msg_obj,{
            token: msg.meta.bot_token, 
            text: "It seems like you're logging a parcel delivery. Log it using `/package (in|out) [for (@user|name)] from <name|address>` or type `/package help` for more options.",
            channel: data.channel.id
            }), (err,data) => {
                if(err){

                    console.log(err)
                }
            })
        })
    }
})

// Listening for file uploads which get sent to the deliveries channel (unprompted)
//slapp.message()

//*********************************************
// Setup different handlers for messages
//*********************************************

// response to the user typing "help"
slapp.message('help', ['mention', 'direct_message'], (msg) => {
  msg.say(HELP_TEXT)
})

// "Conversation" flow that tracks state - kicks off when user says hi, hello or hey
slapp
  .message('^(hi|hello|hey)$', ['direct_mention', 'direct_message'], (msg, text) => {
    msg
      .say([
        'Hiya :flag-gb:',
        "G'day :flag-au:",
        'Nǐ hǎo :flag-cn:',
        'Hola :flag-sp:',
        'Suup Dawwg :flag-us:',
        'Konnichiwa! :flag-jp:',
        'Ciao! :flag-it:',
        'Bonjour! :flag-fr:',
        'Salam! :flag-ir:',
        'Sawasdee! :flag-th'
        ])
      // sends next event from user to this route, passing along state
      //.route('how-are-you', { greeting: text })
  })

// Can use a regex as well
slapp.message(/^(thanks|thank you|thx|ty)/i, ['mention', 'direct_message'], (msg) => {
  // You can provide a list of responses, and a random one will be chosen
  // You can also include slack emoji in your responses
  msg.say([
    "You're welcome :smile:",
    'You bet',
    ':+1: Of course',
    'Anytime :sun_with_face: :full_moon_with_face:'
  ])
})

// custom response
slapp.message('surprise bitches(.*)', ['ambient','direct_message','direct_mention','mention'], (msg) => {
  msg.say({
    text: 'Surprise Bitches!',
    attachments: [{
      text: 'Surprise',
      image_url: 'http://i.giphy.com/dUA1wVWqx8p8s.gif',
    }]
  })
})

// Catch-all for any other responses not handled above
slapp.message('.*', ['direct_mention', 'direct_message'], (msg) => {
    // respond only 40% of the time
  if (Math.random() < 0.4) {
    msg.say([':wave:', ':pray:', ':raised_hands:'])
  }
})

// attach Slapp to express server
var server = slapp.attachToExpress(express())

// start http server
server.listen(port, (err) => {
  if (err) {
    return console.error(err)
  }

  console.log(`Listening on port ${port}`)
})
