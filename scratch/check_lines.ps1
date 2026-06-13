$f = [IO.File]::ReadAllLines("f:\Pack2U_상품정보sheet\_partnerExclusivePush.gs")
for ($i = 4811; $i -lt 4866; $i++) {
    Write-Host ("{0}: {1}" -f ($i+1), $f[$i])
}
