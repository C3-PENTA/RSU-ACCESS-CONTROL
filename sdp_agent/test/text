EmergencyVehicleAlert ::= SEQUENCE {
 timeStamp MinuteOfTheYear OPTIONAL,
 id TemporaryID OPTIONAL, 
 rsaMsg RoadSideAlert, 
 -- the DSRCmsgID inside this 
 -- data frame is set as per the 
-- RoadSideAlert. 
 responseType ResponseType OPTIONAL, 
 details EmergencyDetails OPTIONAL, 
 -- Combines these 3 items: 
-- SirenInUse, 
-- LightbarInUse, 
 -- MultiVehicleReponse,
 mass VehicleMass OPTIONAL,
 basicType VehicleType OPTIONAL, 
 -- gross size and axle cnt
 
 -- type of vehicle and agency when known
 vehicleType ITIS.VehicleGroupAffected OPTIONAL, 
 responseEquip ITIS.IncidentResponseEquipment OPTIONAL, 
 responderType ITIS.ResponderGroupAffected OPTIONAL, 
 regional SEQUENCE (SIZE(1..4)) OF 
 RegionalExtension {{REGION.Reg-EmergencyVehicleAlert}} OPTIONAL,
 ...
 }
