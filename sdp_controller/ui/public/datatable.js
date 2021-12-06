$(document).ready(function(){
	
	$.ajax({
		 url: "/api/crud/v_closed_connection"
		,success: function(res){
			var item = res.json;

			var row = new Array();
			for(var i=0; i<item.length; i++){
				var column = new Array();

				column.push(item[i].client);
				column.push(item[i].gw);
				column.push(item[i].service);
				column.push(item[i].sessionID);
				column.push(item[i].source_ip);
				column.push(item[i].source_port);
				column.push(item[i].destination_ip);
				column.push(item[i].destination_port);
				column.push(item[i].locality);
				column.push(historyFormatTime(item[i].st_time));
				column.push(historyFormatTime(item[i].en_time));

				row.push(column);
			}

			console.log(row);

			$("#sdp-history").DataTable({
				 data: row
				,columns: [
                     {title: "Client"}
					,{title: "Gateway"}	
					,{title: "Service"}	
                    ,{title: "session ID"}
					,{title: "Source IP"}	
					,{title: "Source Port"}	
					,{title: "Destination IP"}	
					,{title: "Destination Port"}	
					,{title: "locality"}
                    ,{title: "Start time"}	
					,{title: "End time"}	
				]
			});

		}
	});
});

var historyFormatTime = function(unixTimestamp) {
	Number.prototype.padLeft = function(base,chr){
      var len = (String(base || 10).length - String(this).length)+1;
      return len > 0? new Array(len).join(chr || '0')+this : this;
    }

    var dt = new Date(unixTimestamp * 1000);

    var year = dt.getFullYear();
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

    return year + "-" + month + "-:" + date+" "+hours + ":" + minutes + ":" + seconds;
    //return hours + ":" + minutes + ":" + seconds;
}
