$(document).ready(function(){

	$.ajax({
		 url: "/api/crud/v_conn_name"
		,success: function(res){

			var row = new Object();
			for(var i=0; i<res.json.length; i++){

				var item = new Object();
				item.service 			= res.json[i].service;
				item.st_time 			= res.json[i].st_time;
				item.en_time 			= res.json[i].en_time;
				item.protocol 			= res.json[i].protocol;
				item.source_ip 			= res.json[i].source_ip;
				item.source_port 		= res.json[i].source_port;
				item.destination_ip 	= res.json[i].destination_ip;
				item.destination_port 	= res.json[i].destination_port;
				item.connected 			= (res.json[i].en_time == 0);

				if(!row[res.json[i].gw])
					row[res.json[i].gw] = new Object();
				if(!row[res.json[i].gw][res.json[i].client])
					row[res.json[i].gw][res.json[i].client] = new Array();

				row[res.json[i].gw][res.json[i].client].push(item);

			}

			var html = "";
			var i = 0;
			$.each(row, function(gateway_name, client){

				html += "<div class='jumbotron' style='background-color:#FFF;'>";	
				html += "	<div class='row'>";
				html += "		<div class='col-md-2 sdp-client' id='client_"+i+"'>";
				html += "		</div>";
				html += "		<div class='col-md-8 sdp-line' id='line_"+i+"'>";
				html += "		</div>";
				html += "		<div class='col-md-2 sdp-gateway'>";
				html += "			<div class='jumbotron border border-danger bg-light gateway-box'>";
				html += "				<small class='text-muted'>Gateway</small>";
				html += "				<h5>"+gateway_name+"</h5>";
				html += "			</div>";
				html += "		</div>";
				html += "	</div>";
				html += "</div>";
				$("#statusBox").append(html);

				var j = 0;
				$.each(client, function(client_name, connect){
					html  = "<div class='jumbotron border border-primary bg-light client-box' id='clientbox_"+j+"'>";
					html += "	<small class='text-muted'>Client</small>";
					html += "	<h5>"+client_name+"</h5>";
					html += "</div>";
					$("#client_"+i).append(html);

					html  = "<div class='jumbotron bg-white line-box' id='connect_"+j+"'>";
					html += "</div>";
					$("#line_"+i).append(html);

					var k = 0;
					var h = "";
					$.each(connect, function(key, val){
						h = "&nbsp;&nbsp;&nbsp;";
						h += "["+val["service"]+"] ";
						h += val["protocol"]+", ";
						h += "Source: "+val["source_ip"]+":"+val["source_port"]+", ";
						h += "Destination: "+val["destination_ip"]+":"+val["destination_port"]+", ";

						html  = "<div class='progress'>";
						if(val["connected"]){
							h += "Duration: "+formatTime(val["st_time"])+"~";
							html += "	<div class='progress-bar progress-bar-striped progress-bar-animated bg-primary text-left'>"+h+"</div>";
						}else{
							h += "Duration: "+formatTime(val["st_time"])+"~"+formatTime(val["en_time"]);
							html += "	<div class='progress-bar bg-secondary text-left'>"+h+"</div>";
						
						}
						html += "</div>";	

						$("#connect_"+j).append(html);

						if(k > 3){
							$("#connect_"+j).css("padding-bottom", "15px");
							$("#clientbox_"+j).css("height", $("#connect_"+j).height()+20);
						}

						k++;
					});

					j++;
				});

				i++;
			});

				/*

				$(".gateway-box h5").text(gateway_name);

				var client_html = "";
				$.each(client, function(client_name, connect){

					$(templete_client).find("h5").text(client_name);
					client_html += templete_client[0].outerHTML;
	
					var templete_conn = "";
					var h = "";
					var connect_html = "";
					var count = 0;
					$.each(connect, function(key, val){
						if(val["connected"]){
							templete_conn = templete_connect;	
							$(templete_conn).children().addClass("progress-bar-striped");
							$(templete_conn).children().addClass("progress-bar-animated");
							$(templete_conn).children().removeClass("bg-secondary");
							$(templete_conn).children().addClass("bg-primary");
						}else{
							templete_conn = templete_connect;	
							$(templete_conn).children().removeClass("progress-bar-striped");
							$(templete_conn).children().removeClass("progress-bar-animated");
							$(templete_conn).children().removeClass("bg-primary");
							$(templete_conn).children().addClass("bg-secondary");
						}

						h = "&nbsp;&nbsp;&nbsp;";
						h += "["+val["service"]+"] ";
						h += val["protocol"]+", ";
						h += "Source: "+val["source_ip"]+":"+val["source_port"]+", ";
						h += "Destination: "+val["destination_ip"]+":"+val["destination_port"]+", ";
						h += "Duration: "+formatTime(val["st_time"])+"~"+formatTime(val["en_time"]);
						//h += "Duration: "+formatTime(val["st_time"])+":"+formatTime(val["en_time"]);

						$(templete_conn).children().css("text-align", "left").html(h);

						connect_html += templete_conn[0].outerHTML;

						if(++count > 3){
							console.log(this);
						}
					});

					$(templete_line).html(connect_html);
					$(".sdp-line").html(templete_line);

				});

				$(".sdp-client").html(client_html);
			});
			*/
		}
	});

});

var formatTime = function(unixTimestamp) {
	Number.prototype.padLeft = function(base,chr){
      var len = (String(base || 10).length - String(this).length)+1;
      return len > 0? new Array(len).join(chr || '0')+this : this;
    }

    var dt = new Date(unixTimestamp * 1000);

    var month = (dt.getMonth()+1).padLeft();
    var date = dt.getDate().padLeft();
    var hours = dt.getHours();
    var minutes = dt.getMinutes();
    var seconds = dt.getSeconds();

    // the above dt.get...() functions return a single digit
    // so I prepend the zero here when needed
    if (hours < 10)
     hours = '0' + hours;

    if (minutes < 10)
     minutes = '0' + minutes;

    if (seconds < 10)
     seconds = '0' + seconds;

    //return month + ":" + date+" "+hours + ":" + minutes + ":" + seconds;
    return hours + ":" + minutes + ":" + seconds;
}
