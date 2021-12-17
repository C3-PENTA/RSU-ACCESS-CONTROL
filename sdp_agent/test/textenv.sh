#!/bin/bash

. $(dirname $0)/env.sh

enckey="11ffeeff"

# u2 try downloading non-existent parcel p1 (ERROR)
# faucet transfer 1 AMO to u2
# u1 upload encrypted file f1 to storage, obtain parcel id p1
# u1 register p1
# u1 discard p1
# u1 register p1
# u2 try downloading ungranted parcel p1 (ERROR)
# u2 request p1 with 1 AMO
# u2 cancel request for p1
# u2 request p1 with 1 AMO
# u2 try downloading ungranted parcel p1 (ERROR)
# u1 grant u2 on p1, collect 1 AMO
# u2 download encrypted file f1 associated with parcel id p1
# u2 decrypt f1 with key custody granted by u1
# u1 revoke grant given to u2 on p1
# u2 try downloading revoked parcel p1 (ERROR)
# u1 remove p1 from storage
# u1 transfer 1 AMO to faucet

fail() {
	echo "test failed"
	echo $1
	exit -1
}