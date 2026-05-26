# Custom fonts

Drop `.ttf` or `.otf` files here (subdirs ok). They survive `scripts/sync-fonts.sh`
(which only cleans top-level Brother fonts).

After adding files, rebuild the catalog:

```
python3 scripts/build-font-catalog.py
```
